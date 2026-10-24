// Edge Function "gateway" — acesso privilegiado ao banco (service_role).
//
// POR QUE EXISTE (ver roadmap.md, decisão de 24/10/2026): o servidor do site
// roda no Lovable (Cloudflare Workers) e lá a chave secreta do banco só
// chegava por um segredo do Lovable, que não era injetado de forma confiável
// a cada publicação — quebrava o cadastro de aparelho a cada deploy. Aqui, no
// Edge Function do Supabase, a própria plataforma injeta SUPABASE_URL e
// SUPABASE_SERVICE_ROLE_KEY automaticamente e para sempre. Nenhum segredo
// manual, nenhuma dependência do Lovable.
//
// SEGURANÇA: a função é pública (verify_jwt desligado), mas cada ação faz a
// PRÓPRIA autenticação — ações do TI exigem um JWT válido de usuário com papel
// 'ti'. Nunca devolve a chave secreta; só resultados das operações.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOGIN_CODE_DOMAIN = "meucelular.local";

function admin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

class AppError extends Error {}

/** Valida o JWT e devolve o id do usuário (sem exigir papel). */
async function requireUser(db: ReturnType<typeof admin>, authHeader: string | null) {
  const jwt = authHeader?.replace(/^Bearer\s+/i, "")?.trim();
  if (!jwt) throw new AppError("Não autenticado.");
  const { data: userData, error } = await db.auth.getUser(jwt);
  if (error || !userData?.user) throw new AppError("Sessão inválida. Entre de novo.");
  return userData.user.id;
}

/** Exige um JWT de usuário com papel 'ti'. Devolve o id do usuário. */
async function requireTi(db: ReturnType<typeof admin>, authHeader: string | null) {
  const userId = await requireUser(db, authHeader);
  const { data: isTi } = await db.rpc("has_role", { _user_id: userId, _role: "ti" });
  if (isTi !== true) throw new AppError("Apenas o time de TI pode fazer isso.");
  return userId;
}

/**
 * Para o espelhamento: quem acessa precisa ser o DONO do aparelho ou do TI.
 * Devolve o aparelho. Lança se não tiver acesso.
 */
async function requireDeviceOwnerOrTi(
  db: ReturnType<typeof admin>,
  authHeader: string | null,
  deviceId: string,
) {
  const userId = await requireUser(db, authHeader);
  const { data: device } = await db
    .from("devices")
    .select("id, owner_user_id")
    .eq("id", deviceId)
    .maybeSingle();
  if (!device) throw new AppError("Aparelho não encontrado.");
  if (device.owner_user_id === userId) return device;
  const { data: isTi } = await db.rpc("has_role", { _user_id: userId, _role: "ti" });
  if (isTi !== true) throw new AppError("Você não tem acesso a este aparelho.");
  return device;
}

async function logAudit(
  db: ReturnType<typeof admin>,
  entry: {
    event_type: string;
    device_id?: string | null;
    user_id?: string | null;
    session_id?: string | null;
    details?: Record<string, unknown> | null;
  },
) {
  await db.from("audit_log").insert(entry);
}

// ---- Ações ---------------------------------------------------------------

async function createTiAccount(
  db: ReturnType<typeof admin>,
  p: { loginCode: string; password: string; name: string },
) {
  const { data: taken } = await db
    .from("profiles")
    .select("id")
    .eq("login_code", p.loginCode)
    .maybeSingle();
  if (taken) throw new AppError("Esse código de acesso já está em uso. Escolha outro.");

  const { data: created, error: createError } = await db.auth.admin.createUser({
    email: `${p.loginCode}@${LOGIN_CODE_DOMAIN}`,
    password: p.password,
    email_confirm: true,
  });
  if (createError || !created?.user) {
    const message = createError?.message ?? "";
    if (/already|registered|exists/i.test(message))
      throw new AppError("Esse código de acesso já está em uso. Escolha outro.");
    throw new AppError(`Não foi possível criar o login${message ? `: ${message}` : "."}`);
  }
  const userId = created.user.id;

  const { error: profileError } = await db
    .from("profiles")
    .insert({ id: userId, login_code: p.loginCode, name: p.name });
  const { error: roleError } = profileError
    ? { error: null }
    : await db.from("user_roles").insert({ user_id: userId, role: "ti" });

  if (profileError || roleError) {
    await db.from("profiles").delete().eq("id", userId);
    await db.auth.admin.deleteUser(userId);
    throw new AppError((profileError ?? roleError)?.message ?? "Não foi possível criar o login.");
  }

  await logAudit(db, { event_type: "conta_criada", user_id: userId, details: { role: "ti" } });
  return { ok: true as const };
}

async function registerDevice(
  db: ReturnType<typeof admin>,
  userId: string,
  p: { deviceName: string; professionalName: string },
) {
  const enrollmentToken = crypto.randomUUID();
  const { data: device, error } = await db
    .from("devices")
    .insert({
      professional_name: p.professionalName,
      name: p.deviceName,
      model: "A confirmar na ativação",
      enrollment_status: "pendente",
      enrollment_token: enrollmentToken,
    })
    .select("id")
    .single();
  if (error) throw new AppError(error.message);

  await logAudit(db, {
    event_type: "enrollment_iniciado",
    device_id: device.id,
    user_id: userId,
    details: { professional_name: p.professionalName },
  });

  return {
    deviceId: device.id as string,
    deviceName: p.deviceName,
    professionalName: p.professionalName,
    enrollmentToken,
  };
}

async function acceptEnrollment(
  db: ReturnType<typeof admin>,
  userId: string,
  p: { deviceId: string; enrollmentToken: string },
) {
  const { data: device } = await db
    .from("devices")
    .select("id, enrollment_token, enrollment_status")
    .eq("id", p.deviceId)
    .maybeSingle();
  if (!device) throw new AppError("Aparelho não encontrado.");
  if (device.enrollment_token !== p.enrollmentToken)
    throw new AppError("Token de ativação inválido.");

  const { error } = await db
    .from("devices")
    .update({
      enrollment_status: "ativo",
      enrolled_at: new Date().toISOString(),
      enrolled_by_user_id: userId,
    })
    .eq("id", p.deviceId);
  if (error) throw new AppError(error.message);

  await logAudit(db, { event_type: "enrollment_concluido", device_id: p.deviceId, user_id: userId });
  return { ok: true as const };
}

async function revokeDevice(
  db: ReturnType<typeof admin>,
  userId: string,
  p: { deviceId: string },
) {
  await db
    .from("access_sessions")
    .update({ status: "encerrada", ended_at: new Date().toISOString() })
    .eq("device_id", p.deviceId)
    .eq("status", "ativa");

  const { error } = await db
    .from("devices")
    .update({ enrollment_status: "revogado", device_secret: null })
    .eq("id", p.deviceId);
  if (error) throw new AppError(error.message);

  await logAudit(db, { event_type: "gestao_revogada", device_id: p.deviceId, user_id: userId });
  return { ok: true as const };
}

async function startSession(
  db: ReturnType<typeof admin>,
  userId: string,
  p: { deviceId: string; reason: string; mode: "visualizacao" | "controle" },
) {
  const { data: device } = await db
    .from("devices")
    .select("id, enrollment_status")
    .eq("id", p.deviceId)
    .maybeSingle();
  if (!device) throw new AppError("Aparelho não encontrado.");
  if (device.enrollment_status !== "ativo")
    throw new AppError("Este aparelho ainda não está ativo.");

  const { data: open } = await db
    .from("access_sessions")
    .select("id")
    .eq("device_id", p.deviceId)
    .eq("status", "ativa")
    .maybeSingle();
  if (open) throw new AppError("Já existe uma sessão de acesso ativa para este aparelho.");

  const { data: session, error } = await db
    .from("access_sessions")
    .insert({
      device_id: p.deviceId,
      requested_by_user_id: userId,
      reason: p.reason,
      mode: p.mode,
      status: "ativa",
    })
    .select("id, started_at")
    .single();
  if (error) throw new AppError(error.message);

  await logAudit(db, {
    event_type: "sessao_iniciada",
    device_id: p.deviceId,
    user_id: userId,
    session_id: session.id,
    details: { mode: p.mode, reason: p.reason },
  });

  return { sessionId: session.id as string, startedAt: session.started_at as string };
}

async function endSession(
  db: ReturnType<typeof admin>,
  userId: string,
  p: { sessionId: string },
) {
  const { data: session } = await db
    .from("access_sessions")
    .select("id, device_id, status")
    .eq("id", p.sessionId)
    .maybeSingle();
  if (!session) throw new AppError("Sessão não encontrada.");
  if (session.status === "encerrada") return { ok: true as const };

  const { error } = await db
    .from("access_sessions")
    .update({ status: "encerrada", ended_at: new Date().toISOString() })
    .eq("id", p.sessionId);
  if (error) throw new AppError(error.message);

  await logAudit(db, {
    event_type: "sessao_encerrada",
    device_id: session.device_id,
    user_id: userId,
    session_id: session.id,
  });
  return { ok: true as const };
}

// ---- Comandos remotos (TI) ----------------------------------------------

async function issueDeviceCommand(
  db: ReturnType<typeof admin>,
  userId: string,
  p: { deviceId: string; kind: "lock" | "reboot" | "wipe"; confirmWipe?: boolean },
) {
  if (p.kind === "wipe" && p.confirmWipe !== true)
    throw new AppError("Apagar o aparelho exige confirmação explícita.");

  const { data: device } = await db
    .from("devices")
    .select("id, enrollment_status, device_owner")
    .eq("id", p.deviceId)
    .maybeSingle();
  if (!device) throw new AppError("Aparelho não encontrado.");
  if (device.enrollment_status !== "ativo") throw new AppError("Este aparelho não está ativo.");
  // Decisão de 23/10/2026 (roadmap.md): só aparelho que virou "dono do
  // aparelho" no enrollment aceita estes comandos.
  if (!device.device_owner)
    throw new AppError(
      'Este aparelho foi ativado sem virar "dono do aparelho" (provavelmente já tinha conta ' +
        "configurada) - bloquear/reiniciar/apagar remotos não funcionam nele. Só reset de " +
        "fábrica e reativação resolvem isso.",
    );

  // Evita empilhar o mesmo comando por cliques repetidos.
  const { data: pending } = await db
    .from("device_commands")
    .select("id")
    .eq("device_id", p.deviceId)
    .eq("kind", p.kind)
    .is("delivered_at", null)
    .limit(1);
  if (pending && pending.length > 0)
    throw new AppError("Esse comando já foi enviado e está aguardando o aparelho buscar.");

  const { data: command, error } = await db
    .from("device_commands")
    .insert({ device_id: p.deviceId, kind: p.kind, requested_by_user_id: userId })
    .select("id")
    .single();
  if (error) throw new AppError(error.message);

  await logAudit(db, {
    event_type: "comando_enviado",
    device_id: p.deviceId,
    user_id: userId,
    details: { kind: p.kind },
  });

  return { ok: true as const, commandId: command.id as string };
}

// ---- Espelhamento, lado painel (dono ou TI) ------------------------------

async function getDeviceFrameUrl(db: ReturnType<typeof admin>, p: { deviceId: string }) {
  const { data: signed, error } = await db.storage
    .from("device-frames")
    .createSignedUrl(`${p.deviceId}.jpg`, 10);
  if (error || !signed) return { found: false as const, url: null };
  return { found: true as const, url: signed.signedUrl as string };
}

async function sendDeviceInput(
  db: ReturnType<typeof admin>,
  p: {
    deviceId: string;
    kind: "tap" | "swipe";
    x: number;
    y: number;
    x2?: number;
    y2?: number;
    durationMs?: number;
  },
) {
  const { data: session } = await db
    .from("access_sessions")
    .select("id")
    .eq("device_id", p.deviceId)
    .eq("status", "ativa")
    .eq("mode", "controle")
    .maybeSingle();
  if (!session)
    throw new AppError("Não há sessão em modo controle ativa para este aparelho no momento.");

  const { error } = await db.from("session_inputs").insert({
    session_id: session.id,
    device_id: p.deviceId,
    kind: p.kind,
    x: p.x,
    y: p.y,
    x2: p.x2 ?? null,
    y2: p.y2 ?? null,
    duration_ms: p.durationMs ?? null,
  });
  if (error) throw new AppError(error.message);
  return { ok: true as const };
}

// ---- Android Enterprise, só banco (TI) -----------------------------------
// As chamadas ao Google continuam no servidor Nitro (android-management.server);
// aqui ficam só as leituras/escritas no banco, que precisam de service_role.

async function getEnterpriseConfig(db: ReturnType<typeof admin>) {
  const { data } = await db
    .from("enterprise_config")
    .select("enterprise_name, default_policy_name, pending_state, pending_signup_url_name")
    .eq("id", true)
    .maybeSingle();
  return {
    enterpriseName: data?.enterprise_name ?? null,
    defaultPolicyName: data?.default_policy_name ?? null,
    pendingState: data?.pending_state ?? null,
    pendingSignupUrlName: data?.pending_signup_url_name ?? null,
  };
}

async function saveEnterprisePending(
  db: ReturnType<typeof admin>,
  p: { state: string; signupUrlName: string },
) {
  const { error } = await db.from("enterprise_config").upsert({
    id: true,
    pending_state: p.state,
    pending_signup_url_name: p.signupUrlName,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new AppError(error.message);
  return { ok: true as const };
}

async function saveEnterpriseConfigured(
  db: ReturnType<typeof admin>,
  p: { enterpriseName: string; policyName: string },
) {
  const { error } = await db.from("enterprise_config").upsert({
    id: true,
    enterprise_name: p.enterpriseName,
    default_policy_name: p.policyName,
    pending_state: null,
    pending_signup_url_name: null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new AppError(error.message);
  return { ok: true as const };
}

async function getDeviceStatus(db: ReturnType<typeof admin>, p: { deviceId: string }) {
  const { data: device } = await db
    .from("devices")
    .select("id, enrollment_status")
    .eq("id", p.deviceId)
    .maybeSingle();
  if (!device) throw new AppError("Aparelho não encontrado.");
  return { enrollmentStatus: device.enrollment_status as string };
}

async function saveDeviceQr(
  db: ReturnType<typeof admin>,
  p: {
    deviceId: string;
    tokenName: string;
    tokenValue: string;
    qrPng: string;
    expiresAt: string;
  },
) {
  const { error } = await db
    .from("devices")
    .update({
      android_enrollment_token_name: p.tokenName,
      android_enrollment_token_value: p.tokenValue,
      android_enrollment_qr_png: p.qrPng,
      android_enrollment_expires_at: p.expiresAt,
    })
    .eq("id", p.deviceId);
  if (error) throw new AppError(error.message);
  return { ok: true as const };
}

// ---- Roteador ------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método não suportado" }, 405);

  let body: { action?: string; payload?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Corpo inválido" }, 400);
  }
  const action = body.action ?? "";
  const payload = (body.payload ?? {}) as Record<string, unknown>;
  const authHeader = req.headers.get("authorization");
  const db = admin();

  try {
    switch (action) {
      // Teste de saúde: prova que o service_role chega aqui (conta aparelhos).
      case "health": {
        const { count } = await db
          .from("devices")
          .select("id", { count: "exact", head: true });
        return json({ data: { ok: true, devices: count ?? 0 } });
      }
      case "createTiAccount":
        return json({ data: await createTiAccount(db, payload as any) });
      case "registerDevice": {
        const userId = await requireTi(db, authHeader);
        return json({ data: await registerDevice(db, userId, payload as any) });
      }
      case "acceptEnrollment": {
        const userId = await requireTi(db, authHeader);
        return json({ data: await acceptEnrollment(db, userId, payload as any) });
      }
      case "revokeDevice": {
        const userId = await requireTi(db, authHeader);
        return json({ data: await revokeDevice(db, userId, payload as any) });
      }
      case "startSession": {
        const userId = await requireTi(db, authHeader);
        return json({ data: await startSession(db, userId, payload as any) });
      }
      case "endSession": {
        const userId = await requireTi(db, authHeader);
        return json({ data: await endSession(db, userId, payload as any) });
      }
      case "issueDeviceCommand": {
        const userId = await requireTi(db, authHeader);
        return json({ data: await issueDeviceCommand(db, userId, payload as any) });
      }
      case "getDeviceFrameUrl": {
        await requireDeviceOwnerOrTi(db, authHeader, (payload as any).deviceId);
        return json({ data: await getDeviceFrameUrl(db, payload as any) });
      }
      case "sendDeviceInput": {
        await requireDeviceOwnerOrTi(db, authHeader, (payload as any).deviceId);
        return json({ data: await sendDeviceInput(db, payload as any) });
      }
      case "getEnterpriseConfig": {
        await requireTi(db, authHeader);
        return json({ data: await getEnterpriseConfig(db) });
      }
      case "saveEnterprisePending": {
        await requireTi(db, authHeader);
        return json({ data: await saveEnterprisePending(db, payload as any) });
      }
      case "saveEnterpriseConfigured": {
        await requireTi(db, authHeader);
        return json({ data: await saveEnterpriseConfigured(db, payload as any) });
      }
      case "getDeviceStatus": {
        await requireTi(db, authHeader);
        return json({ data: await getDeviceStatus(db, payload as any) });
      }
      case "saveDeviceQr": {
        await requireTi(db, authHeader);
        return json({ data: await saveDeviceQr(db, payload as any) });
      }
      default:
        return json({ error: `Ação desconhecida: ${action}` }, 400);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro inesperado.";
    // 401 para falha de autenticação, 400 para o resto das regras de negócio.
    const status = /autenticad|sessão inválida|time de ti/i.test(msg) ? 401 : 400;
    return json({ error: msg }, status);
  }
});
