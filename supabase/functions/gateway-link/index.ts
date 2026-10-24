// Edge Function "gateway-link" — caminho do PROFISSIONAL (sem login).
//
// Par da função "gateway" (operações do TI). Separada só por praticidade de
// deploy. Mesma ideia (decisão de 24/10/2026, ver roadmap.md): roda com
// service_role injetado pelo Supabase, sem segredo manual no Lovable.
//
// Autenticação: a POSSE do token do link (devices.enrollment_token, exposto
// em /instalar/<token>) — mesmo modelo do device_secret do app. Cada ação
// revalida o token. Função pública (verify_jwt off).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ORIGIN = { origem: "link_do_profissional" };

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

async function logAudit(
  db: ReturnType<typeof admin>,
  entry: { event_type: string; device_id: string; session_id?: string | null; details?: Record<string, unknown> | null },
) {
  await db.from("audit_log").insert({ ...entry, user_id: null });
}

async function deviceFromToken(db: ReturnType<typeof admin>, token: string, requireActive: boolean) {
  if (!token || token.length < 8) throw new AppError("Link inválido ou já usado.");
  const { data: device } = await db
    .from("devices")
    .select("id, name, model, professional_name, enrollment_status, battery_level, last_seen_at")
    .eq("enrollment_token", token)
    .maybeSingle();
  if (!device) throw new AppError("Link inválido ou já usado.");
  if (device.enrollment_status === "revogado")
    throw new AppError("Este aparelho teve a gestão revogada. Fale com o time de TI.");
  if (requireActive && device.enrollment_status !== "ativo")
    throw new AppError("Este aparelho ainda não está ativo.");
  return device;
}

async function getDevice(db: ReturnType<typeof admin>, p: { token: string }) {
  const device = await deviceFromToken(db, p.token, false);
  const { data: session } = await db
    .from("access_sessions")
    .select("id, mode, reason, started_at")
    .eq("device_id", device.id)
    .eq("status", "ativa")
    .maybeSingle();
  return {
    name: device.name,
    model: device.model,
    professionalName: device.professional_name,
    status: device.enrollment_status,
    batteryLevel: device.battery_level,
    lastSeenAt: device.last_seen_at,
    activeSession: session ?? null,
  };
}

async function registerAceite(db: ReturnType<typeof admin>, p: { token: string }) {
  const device = await deviceFromToken(db, p.token, false);
  if (device.enrollment_status !== "pendente") return { ok: true };
  const { data: previous } = await db
    .from("audit_log")
    .select("id")
    .eq("device_id", device.id)
    .eq("event_type", "aceite_registrado")
    .limit(1);
  if (!previous || previous.length === 0) {
    await logAudit(db, {
      event_type: "aceite_registrado",
      device_id: device.id,
      details: { origem: "pagina_de_instalacao" },
    });
  }
  return { ok: true };
}

async function startSession(db: ReturnType<typeof admin>, p: { token: string; reason: string; mode: string }) {
  const device = await deviceFromToken(db, p.token, true);
  const { data: open } = await db
    .from("access_sessions")
    .select("id")
    .eq("device_id", device.id)
    .eq("status", "ativa")
    .maybeSingle();
  if (open) throw new AppError("Já existe uma sessão de acesso ativa para este aparelho.");

  const { data: session, error } = await db
    .from("access_sessions")
    .insert({ device_id: device.id, requested_by_user_id: null, reason: p.reason, mode: p.mode, status: "ativa" })
    .select("id, started_at")
    .single();
  if (error) throw new AppError(error.message);

  await logAudit(db, {
    event_type: "sessao_iniciada",
    device_id: device.id,
    session_id: session.id,
    details: { mode: p.mode, reason: p.reason, ...ORIGIN },
  });
  return { sessionId: session.id as string, startedAt: session.started_at as string };
}

async function endSession(db: ReturnType<typeof admin>, p: { token: string; sessionId: string }) {
  const device = await deviceFromToken(db, p.token, false);
  const { data: session } = await db
    .from("access_sessions")
    .select("id, device_id, status")
    .eq("id", p.sessionId)
    .maybeSingle();
  if (!session || session.device_id !== device.id) throw new AppError("Sessão não encontrada.");
  if (session.status === "encerrada") return { ok: true };
  const { error } = await db
    .from("access_sessions")
    .update({ status: "encerrada", ended_at: new Date().toISOString() })
    .eq("id", session.id);
  if (error) throw new AppError(error.message);
  await logAudit(db, { event_type: "sessao_encerrada", device_id: device.id, session_id: session.id, details: ORIGIN });
  return { ok: true };
}

async function getFrameUrl(db: ReturnType<typeof admin>, p: { token: string }) {
  const device = await deviceFromToken(db, p.token, true);
  const { data: session } = await db
    .from("access_sessions")
    .select("id")
    .eq("device_id", device.id)
    .eq("status", "ativa")
    .maybeSingle();
  if (!session) return { found: false, url: null };
  const { data: signed, error } = await db.storage
    .from("device-frames")
    .createSignedUrl(`${device.id}.jpg`, 10);
  if (error || !signed) return { found: false, url: null };
  return { found: true, url: signed.signedUrl as string };
}

async function sendInput(
  db: ReturnType<typeof admin>,
  p: { token: string; kind: string; x: number; y: number; x2?: number; y2?: number; durationMs?: number },
) {
  const device = await deviceFromToken(db, p.token, true);
  const { data: session } = await db
    .from("access_sessions")
    .select("id")
    .eq("device_id", device.id)
    .eq("status", "ativa")
    .eq("mode", "controle")
    .maybeSingle();
  if (!session)
    throw new AppError("Não há sessão em modo controle ativa para este aparelho no momento.");
  const { error } = await db.from("session_inputs").insert({
    session_id: session.id,
    device_id: device.id,
    kind: p.kind,
    x: p.x,
    y: p.y,
    x2: p.x2 ?? null,
    y2: p.y2 ?? null,
    duration_ms: p.durationMs ?? null,
  });
  if (error) throw new AppError(error.message);
  return { ok: true };
}

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
    switch (action) {
      case "getDevice":
        return json({ data: await getDevice(db, payload) });
      case "registerAceite":
        return json({ data: await registerAceite(db, payload) });
      case "startSession":
        return json({ data: await startSession(db, payload) });
      case "endSession":
        return json({ data: await endSession(db, payload) });
      case "getFrameUrl":
        return json({ data: await getFrameUrl(db, payload) });
      case "sendInput":
        return json({ data: await sendInput(db, payload) });
      default:
        return json({ error: `Ação desconhecida: ${action}` }, 400);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro inesperado.";
    return json({ error: msg }, 400);
  }
});
