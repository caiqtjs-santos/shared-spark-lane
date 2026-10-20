import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Acesso do PROFISSIONAL ao próprio aparelho, SEM login (decisão de
 * 20/10/2026 no roadmap.md). Estas funções são PÚBLICAS de propósito (não
 * usam requireSupabaseAuth): quem chama prova que pode mexer no aparelho só
 * pela posse do token do link /instalar/<token> (devices.enrollment_token) -
 * o mesmo modelo de confiança do device_secret que o app Android usa em
 * src/routes/api/public/agent/*.
 *
 * Toda função revalida o token no servidor a cada chamada: aparelho
 * revogado, token inexistente ou aparelho que não é o da sessão são
 * recusados. As versões autenticadas (mdm.functions.ts e screen.functions.ts)
 * continuam existindo para o painel do TI.
 */

function parseInput<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(issue?.message || "Dados inválidos.");
  }
  return result.data;
}

async function admin() {
  const { supabaseAdmin } = await import("@/lib/backend/admin.server");
  return supabaseAdmin as any;
}

const tokenSchema = z.string().min(8, "Link inválido.").max(200, "Link inválido.");

/** Origem gravada na auditoria para tudo que o profissional faz pelo link. */
const ORIGIN = { origem: "link_do_profissional" };

/** Acha o aparelho pelo token. `requireActive` exige aparelho já ativado. */
async function deviceFromToken(db: any, token: string, opts: { requireActive: boolean }) {
  const { data: device } = await db
    .from("devices")
    .select(
      "id, name, model, professional_name, enrollment_status, battery_level, last_seen_at",
    )
    .eq("enrollment_token", token)
    .maybeSingle();
  if (!device) throw new Error("Link inválido ou já usado.");
  if (device.enrollment_status === "revogado")
    throw new Error("Este aparelho teve a gestão revogada. Fale com o time de TI.");
  if (opts.requireActive && device.enrollment_status !== "ativo")
    throw new Error("Este aparelho ainda não está ativo.");
  return device as {
    id: string;
    name: string;
    model: string;
    professional_name: string | null;
    enrollment_status: "pendente" | "ativo" | "revogado";
    battery_level: number | null;
    last_seen_at: string | null;
  };
}

async function logAudit(
  db: any,
  entry: {
    event_type: string;
    device_id: string;
    session_id?: string | null;
    details?: Record<string, unknown> | null;
  },
) {
  await db.from("audit_log").insert({ ...entry, user_id: null });
}

/** Dados do aparelho + sessão ativa (se houver), a partir do token do link. */
export const getDeviceByToken = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => parseInput(z.object({ token: tokenSchema }), input))
  .handler(async ({ data }) => {
    const db = await admin();
    const device = await deviceFromToken(db, data.token, { requireActive: false });

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
      activeSession: (session ?? null) as {
        id: string;
        mode: "visualizacao" | "controle";
        reason: string;
        started_at: string;
      } | null,
    };
  });

/** Inicia o acesso ao aparelho, com motivo registrado (sem usuário logado). */
export const startSessionByToken = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    parseInput(
      z.object({
        token: tokenSchema,
        reason: z.string().min(5, "Descreva o motivo do acesso com pelo menos 5 letras.").max(500),
        mode: z.enum(["visualizacao", "controle"]),
      }),
      input,
    ),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const device = await deviceFromToken(db, data.token, { requireActive: true });

    const { data: open } = await db
      .from("access_sessions")
      .select("id")
      .eq("device_id", device.id)
      .eq("status", "ativa")
      .maybeSingle();
    if (open) throw new Error("Já existe uma sessão de acesso ativa para este aparelho.");

    const { data: session, error } = await db
      .from("access_sessions")
      .insert({
        device_id: device.id,
        // Sem login: nulo quando o profissional inicia pelo link.
        requested_by_user_id: null,
        reason: data.reason,
        mode: data.mode,
        status: "ativa",
      })
      .select("id, started_at")
      .single();
    if (error) throw new Error(error.message);

    await logAudit(db, {
      event_type: "sessao_iniciada",
      device_id: device.id,
      session_id: session.id,
      details: { mode: data.mode, reason: data.reason, ...ORIGIN },
    });

    return { sessionId: session.id as string, startedAt: session.started_at as string };
  });

/** Encerra uma sessão - só vale se ela for do aparelho dono do token. */
export const endSessionByToken = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    parseInput(
      z.object({
        token: tokenSchema,
        sessionId: z.string().uuid("Identificador de sessão inválido."),
      }),
      input,
    ),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const device = await deviceFromToken(db, data.token, { requireActive: false });

    const { data: session } = await db
      .from("access_sessions")
      .select("id, device_id, status")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (!session || session.device_id !== device.id) throw new Error("Sessão não encontrada.");
    if (session.status === "encerrada") return { ok: true as const };

    const { error } = await db
      .from("access_sessions")
      .update({ status: "encerrada", ended_at: new Date().toISOString() })
      .eq("id", session.id);
    if (error) throw new Error(error.message);

    await logAudit(db, {
      event_type: "sessao_encerrada",
      device_id: device.id,
      session_id: session.id,
      details: ORIGIN,
    });

    return { ok: true as const };
  });

/**
 * URL assinada (10s) do último frame da tela. Só é entregue enquanto há
 * sessão ativa: fora dela, `found: false` - assim um frame antigo, de uma
 * sessão que já acabou, nunca fica acessível pelo link.
 */
export const getDeviceFrameUrlByToken = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => parseInput(z.object({ token: tokenSchema }), input))
  .handler(async ({ data }) => {
    const db = await admin();
    const device = await deviceFromToken(db, data.token, { requireActive: true });

    const { data: session } = await db
      .from("access_sessions")
      .select("id")
      .eq("device_id", device.id)
      .eq("status", "ativa")
      .maybeSingle();
    if (!session) return { found: false as const, url: null };

    const { data: signed, error } = await db.storage
      .from("device-frames")
      .createSignedUrl(`${device.id}.jpg`, 10);
    if (error || !signed) return { found: false as const, url: null };

    return { found: true as const, url: signed.signedUrl as string };
  });

/** Toque/arraste feito pelo profissional sobre o frame (modo "controle"). */
export const sendDeviceInputByToken = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    parseInput(
      z
        .object({
          token: tokenSchema,
          kind: z.enum(["tap", "swipe"]),
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          x2: z.number().min(0).max(1).optional(),
          y2: z.number().min(0).max(1).optional(),
          durationMs: z.number().int().positive().max(5000).optional(),
        })
        .refine((v) => v.kind === "tap" || (v.x2 != null && v.y2 != null), {
          message: "Arrastar precisa do ponto final (x2, y2).",
        }),
      input,
    ),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const device = await deviceFromToken(db, data.token, { requireActive: true });

    const { data: session } = await db
      .from("access_sessions")
      .select("id")
      .eq("device_id", device.id)
      .eq("status", "ativa")
      .eq("mode", "controle")
      .maybeSingle();
    if (!session)
      throw new Error("Não há sessão em modo controle ativa para este aparelho no momento.");

    const { error } = await db.from("session_inputs").insert({
      session_id: session.id,
      device_id: device.id,
      kind: data.kind,
      x: data.x,
      y: data.y,
      x2: data.x2 ?? null,
      y2: data.y2 ?? null,
      duration_ms: data.durationMs ?? null,
    });
    if (error) throw new Error(error.message);

    return { ok: true as const };
  });
