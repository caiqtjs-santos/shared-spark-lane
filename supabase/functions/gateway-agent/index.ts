// Edge Function "gateway-agent" — caminho do APP ANDROID (device_secret).
//
// Terceiro caminho, par das funções "gateway" (TI, por JWT) e "gateway-link"
// (profissional, por token do link). Mesma ideia (decisão de 24/10/2026, ver
// roadmap.md): roda com service_role injetado pelo Supabase, sem segredo
// manual no Lovable.
//
// Autenticação: o app manda x-device-id e x-device-secret (emitidos no
// enrollment). A ação "enroll" é a exceção — ainda não há segredo, então ela
// se autentica pela posse do enrollment_token (e só vale uma vez por
// aparelho). Função pública (verify_jwt off); cada ação revalida.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

async function logAudit(
  db: ReturnType<typeof admin>,
  entry: {
    event_type: string;
    device_id?: string | null;
    session_id?: string | null;
    details?: Record<string, unknown> | null;
  },
) {
  await db.from("audit_log").insert({ ...entry, user_id: null });
}

/**
 * Autentica o app pelo par id + segredo (cabeçalhos x-device-id e
 * x-device-secret). Devolve o aparelho ou lança 401.
 */
async function authDevice(db: ReturnType<typeof admin>, req: Request) {
  const deviceId = req.headers.get("x-device-id");
  const secret = req.headers.get("x-device-secret");
  if (!deviceId || !secret) throw new AppError("Aparelho não autorizado", 401);

  const { data } = await db
    .from("devices")
    .select("id, owner_user_id, device_secret, enrollment_status")
    .eq("id", deviceId)
    .maybeSingle();

  if (!data || !data.device_secret || data.device_secret !== secret)
    throw new AppError("Aparelho não autorizado", 401);
  if (data.enrollment_status !== "ativo") throw new AppError("Aparelho não autorizado", 401);
  return data;
}

// ---- Ações ---------------------------------------------------------------

/**
 * Troca o token de ativação por um segredo permanente do aparelho (único
 * aceite do onboarding). O token NÃO é apagado — vira o link permanente do
 * profissional (/instalar/<token>). Para o link não virar forma de roubar o
 * aparelho, a troca só vale UMA vez: aparelho já ativo recusa novo enrollment.
 */
async function enroll(
  db: ReturnType<typeof admin>,
  p: {
    enrollmentToken: string;
    model?: string;
    pushToken?: string;
    screenWidth?: number;
    screenHeight?: number;
    deviceOwner?: boolean;
  },
) {
  if (!p.enrollmentToken || p.enrollmentToken.length < 8)
    throw new AppError("Token de ativação inválido", 404);

  const { data: device } = await db
    .from("devices")
    .select("id, enrollment_status")
    .eq("enrollment_token", p.enrollmentToken)
    .maybeSingle();
  if (!device) throw new AppError("Token de ativação inválido", 404);
  if (device.enrollment_status === "revogado") throw new AppError("Aparelho revogado", 403);
  if (device.enrollment_status !== "pendente")
    throw new AppError("Este aparelho já foi ativado", 409);

  const deviceSecret = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  const now = new Date().toISOString();

  const { error } = await db
    .from("devices")
    .update({
      enrollment_status: "ativo",
      enrolled_at: now,
      device_secret: deviceSecret,
      last_seen_at: now,
      ...(p.model ? { model: p.model } : {}),
      ...(p.pushToken ? { push_token: p.pushToken } : {}),
      ...(p.screenWidth ? { screen_width: p.screenWidth } : {}),
      ...(p.screenHeight ? { screen_height: p.screenHeight } : {}),
      device_owner: p.deviceOwner === true,
    })
    .eq("id", device.id);
  if (error) throw new AppError(error.message, 500);

  await logAudit(db, {
    event_type: "enrollment_concluido",
    device_id: device.id,
    details: { origem: "app_android" },
  });

  return { deviceId: device.id as string, deviceSecret };
}

async function heartbeat(
  db: ReturnType<typeof admin>,
  device: { id: string },
  p: { batteryLevel?: number; pushToken?: string; screenWidth?: number; screenHeight?: number },
) {
  const { error } = await db
    .from("devices")
    .update({
      last_seen_at: new Date().toISOString(),
      ...(p.batteryLevel != null ? { battery_level: p.batteryLevel } : {}),
      ...(p.pushToken ? { push_token: p.pushToken } : {}),
      ...(p.screenWidth ? { screen_width: p.screenWidth } : {}),
      ...(p.screenHeight ? { screen_height: p.screenHeight } : {}),
    })
    .eq("id", device.id);
  if (error) throw new AppError(error.message, 500);
  return { ok: true };
}

async function getSession(db: ReturnType<typeof admin>, device: { id: string }) {
  const { data: session } = await db
    .from("access_sessions")
    .select("id, mode, reason, started_at")
    .eq("device_id", device.id)
    .eq("status", "ativa")
    .maybeSingle();
  return { activeSession: session ?? null };
}

async function endSession(db: ReturnType<typeof admin>, device: { id: string }) {
  const { data: session } = await db
    .from("access_sessions")
    .select("id")
    .eq("device_id", device.id)
    .eq("status", "ativa")
    .maybeSingle();
  if (!session) return { ok: true, encerrada: false };

  await db
    .from("access_sessions")
    .update({ status: "encerrada", ended_at: new Date().toISOString() })
    .eq("id", session.id);

  await logAudit(db, {
    event_type: "sessao_encerrada",
    device_id: device.id,
    session_id: session.id,
    details: { origem: "app_android" },
  });
  return { ok: true, encerrada: true };
}

async function getInputs(db: ReturnType<typeof admin>, device: { id: string }) {
  const { data: pending } = await db
    .from("session_inputs")
    .select("id, kind, x, y, x2, y2, duration_ms")
    .eq("device_id", device.id)
    .is("delivered_at", null)
    .order("created_at", { ascending: true })
    .limit(20);

  if (pending && pending.length > 0) {
    await db
      .from("session_inputs")
      .update({ delivered_at: new Date().toISOString() })
      .in("id", pending.map((p) => p.id));
  }

  return {
    inputs: (pending ?? []).map((p) => ({
      kind: p.kind,
      x: p.x,
      y: p.y,
      x2: p.x2,
      y2: p.y2,
      durationMs: p.duration_ms,
    })),
  };
}

async function postFrame(
  db: ReturnType<typeof admin>,
  device: { id: string },
  p: { frameBase64: string },
) {
  if (!p.frameBase64 || p.frameBase64.length < 100)
    throw new AppError("Dados inválidos", 400);

  const { data: session } = await db
    .from("access_sessions")
    .select("id")
    .eq("device_id", device.id)
    .eq("status", "ativa")
    .maybeSingle();
  if (!session) return { ok: true, active: false };

  let bytes: Uint8Array;
  try {
    const binary = atob(p.frameBase64);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } catch {
    throw new AppError("frameBase64 não é base64 válido", 400);
  }

  const { error } = await db.storage
    .from("device-frames")
    .upload(`${device.id}.jpg`, bytes, { contentType: "image/jpeg", upsert: true });
  if (error) throw new AppError(error.message, 500);

  return { ok: true, active: true };
}

async function getCommands(db: ReturnType<typeof admin>, device: { id: string }) {
  const { data: pendingRaw } = await db
    .from("device_commands")
    .select("id, kind")
    .eq("device_id", device.id)
    .is("delivered_at", null)
    .order("created_at", { ascending: true })
    .limit(5);

  const commands = (pendingRaw ?? []) as { id: string; kind: string }[];
  if (commands.length === 0) return { commands: [] };

  // delivered_at is null evita entregar duas vezes se duas consultas
  // simultâneas pegarem os mesmos comandos.
  const { data: claimedRaw } = await db
    .from("device_commands")
    .update({ delivered_at: new Date().toISOString() })
    .in("id", commands.map((c) => c.id))
    .is("delivered_at", null)
    .select("id, kind");

  const delivered = (claimedRaw ?? []) as { id: string; kind: string }[];
  for (const c of delivered) {
    await logAudit(db, {
      event_type: "comando_entregue",
      device_id: device.id,
      details: { kind: c.kind },
    });
  }
  const order = new Map(commands.map((c, i) => [c.id, i]));
  delivered.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { commands: delivered.map((c) => ({ kind: c.kind })) };
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
  const payload = (body.payload ?? {}) as any;
  const db = admin();

  try {
    // enroll não exige device_secret (ainda não existe); as demais exigem.
    if (action === "enroll") return json({ data: await enroll(db, payload) });

    const device = await authDevice(db, req);
    switch (action) {
      case "heartbeat":
        return json({ data: await heartbeat(db, device, payload) });
      case "getSession":
        return json({ data: await getSession(db, device) });
      case "endSession":
        return json({ data: await endSession(db, device) });
      case "getInputs":
        return json({ data: await getInputs(db, device) });
      case "postFrame":
        return json({ data: await postFrame(db, device, payload) });
      case "getCommands":
        return json({ data: await getCommands(db, device) });
      default:
        return json({ error: `Ação desconhecida: ${action}` }, 400);
    }
  } catch (e) {
    if (e instanceof AppError) return json({ error: e.message }, e.status);
    const msg = e instanceof Error ? e.message : "Erro inesperado.";
    return json({ error: msg }, 400);
  }
});
