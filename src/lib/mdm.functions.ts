import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const sixDigits = z.string().regex(/^\d{6}$/);

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function isTi(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "ti",
  });
  return data === true;
}

async function logAudit(
  db: any,
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

/** Cria o perfil (código de acesso + nome) e o papel logo após o cadastro. */
export const finishSignup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        loginCode: sixDigits,
        name: z.string().min(2).max(80),
        role: z.enum(["profissional", "ti"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();

    const { data: existing } = await db
      .from("profiles")
      .select("id")
      .eq("id", context.userId)
      .maybeSingle();
    if (existing) return { ok: true as const };

    const { error: profileError } = await db.from("profiles").insert({
      id: context.userId,
      login_code: data.loginCode,
      name: data.name,
    });
    if (profileError) throw new Error(profileError.message);

    const { error: roleError } = await db
      .from("user_roles")
      .insert({ user_id: context.userId, role: data.role });
    if (roleError) throw new Error(roleError.message);

    await logAudit(db, {
      event_type: "conta_criada",
      user_id: context.userId,
      details: { role: data.role },
    });

    return { ok: true as const };
  });

/** Perfil, papel, aparelhos, sessão ativa e histórico do usuário logado. */
export const getWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const ti = await isTi(context);

    const [profileRes, devicesRes, sessionsRes, auditRes] = await Promise.all([
      supabase.from("profiles").select("id, login_code, name").eq("id", userId).maybeSingle(),
      supabase
        .from("devices")
        .select(
          "id, name, model, enrollment_status, enrollment_token, owner_user_id, last_seen_at, battery_level, enrolled_at, created_at",
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("access_sessions")
        .select("id, device_id, reason, mode, status, started_at, ended_at, requested_by_user_id")
        .order("started_at", { ascending: false })
        .limit(50),
      supabase
        .from("audit_log")
        .select("id, event_type, device_id, session_id, details, created_at")
        .order("created_at", { ascending: false })
        .limit(60),
    ]);

    return {
      role: ti ? ("ti" as const) : ("profissional" as const),
      profile: profileRes.data ?? null,
      devices: devicesRes.data ?? [],
      sessions: sessionsRes.data ?? [],
      audit: auditRes.data ?? [],
    };
  });

/** TI cadastra o aparelho e recebe o token de ativação para o app do celular. */
export const createDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string().min(1).max(80),
        model: z.string().min(1).max(80),
        ownerLoginCode: sixDigits,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!(await isTi(context))) throw new Error("Apenas o time de TI pode cadastrar aparelhos.");
    const db = await admin();

    const { data: owner } = await db
      .from("profiles")
      .select("id, name")
      .eq("login_code", data.ownerLoginCode)
      .maybeSingle();
    if (!owner) throw new Error("Nenhum profissional encontrado com esse código de acesso.");

    const enrollmentToken = crypto.randomUUID();
    const { data: device, error } = await db
      .from("devices")
      .insert({
        owner_user_id: owner.id,
        name: data.name,
        model: data.model,
        enrollment_status: "pendente",
        enrollment_token: enrollmentToken,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await logAudit(db, {
      event_type: "enrollment_iniciado",
      device_id: device.id,
      user_id: context.userId,
      details: { owner: owner.name },
    });

    return { deviceId: device.id as string, enrollmentToken };
  });

/** O "único aceite": conclui o cadastro do aparelho e deixa registro. */
export const acceptEnrollment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ deviceId: z.string().uuid(), enrollmentToken: z.string().min(8) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!(await isTi(context))) throw new Error("Apenas o time de TI pode concluir a ativação.");
    const db = await admin();

    const { data: device } = await db
      .from("devices")
      .select("id, enrollment_token, enrollment_status")
      .eq("id", data.deviceId)
      .maybeSingle();
    if (!device) throw new Error("Aparelho não encontrado.");
    if (device.enrollment_token !== data.enrollmentToken)
      throw new Error("Token de ativação inválido.");

    const { error } = await db
      .from("devices")
      .update({
        enrollment_status: "ativo",
        enrolled_at: new Date().toISOString(),
        enrolled_by_user_id: context.userId,
      })
      .eq("id", data.deviceId);
    if (error) throw new Error(error.message);

    await logAudit(db, {
      event_type: "enrollment_concluido",
      device_id: data.deviceId,
      user_id: context.userId,
    });

    return { ok: true as const };
  });

/** TI revoga a gestão do aparelho e encerra qualquer sessão aberta. */
export const revokeDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ deviceId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    if (!(await isTi(context))) throw new Error("Apenas o time de TI pode revogar aparelhos.");
    const db = await admin();

    await db
      .from("access_sessions")
      .update({ status: "encerrada", ended_at: new Date().toISOString() })
      .eq("device_id", data.deviceId)
      .eq("status", "ativa");

    const { error } = await db
      .from("devices")
      .update({ enrollment_status: "revogado", device_secret: null })
      .eq("id", data.deviceId);
    if (error) throw new Error(error.message);

    await logAudit(db, {
      event_type: "gestao_revogada",
      device_id: data.deviceId,
      user_id: context.userId,
    });

    return { ok: true as const };
  });

/** O profissional inicia o acesso ao próprio aparelho, com motivo registrado. */
export const startSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        deviceId: z.string().uuid(),
        reason: z.string().min(5).max(500),
        mode: z.enum(["visualizacao", "controle"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();
    const ti = await isTi(context);

    const { data: device } = await db
      .from("devices")
      .select("id, owner_user_id, enrollment_status")
      .eq("id", data.deviceId)
      .maybeSingle();
    if (!device) throw new Error("Aparelho não encontrado.");
    if (!ti && device.owner_user_id !== context.userId)
      throw new Error("Você só pode acessar o próprio aparelho.");
    if (device.enrollment_status !== "ativo")
      throw new Error("Este aparelho ainda não está ativo.");

    const { data: open } = await db
      .from("access_sessions")
      .select("id")
      .eq("device_id", data.deviceId)
      .eq("status", "ativa")
      .maybeSingle();
    if (open) throw new Error("Já existe uma sessão de acesso ativa para este aparelho.");

    const { data: session, error } = await db
      .from("access_sessions")
      .insert({
        device_id: data.deviceId,
        requested_by_user_id: context.userId,
        reason: data.reason,
        mode: data.mode,
        status: "ativa",
      })
      .select("id, started_at")
      .single();
    if (error) throw new Error(error.message);

    await logAudit(db, {
      event_type: "sessao_iniciada",
      device_id: data.deviceId,
      user_id: context.userId,
      session_id: session.id,
      details: { mode: data.mode, reason: data.reason },
    });

    return { sessionId: session.id as string, startedAt: session.started_at as string };
  });

/** Encerra a sessão de acesso. */
export const endSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ sessionId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const ti = await isTi(context);

    const { data: session } = await db
      .from("access_sessions")
      .select("id, device_id, requested_by_user_id, status")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (!session) throw new Error("Sessão não encontrada.");
    if (!ti && session.requested_by_user_id !== context.userId)
      throw new Error("Você só pode encerrar as próprias sessões.");
    if (session.status === "encerrada") return { ok: true as const };

    const { error } = await db
      .from("access_sessions")
      .update({ status: "encerrada", ended_at: new Date().toISOString() })
      .eq("id", data.sessionId);
    if (error) throw new Error(error.message);

    await logAudit(db, {
      event_type: "sessao_encerrada",
      device_id: session.device_id,
      user_id: context.userId,
      session_id: session.id,
    });

    return { ok: true as const };
  });
