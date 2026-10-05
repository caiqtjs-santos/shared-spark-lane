import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Lado "painel web" do espelhamento de tela sem WebRTC/TURN (ver
 * src/routes/api/public/agent/{frame,input}.ts e a migração
 * 20261005181500_screen_mirroring.sql para o desenho completo). Este
 * arquivo é o espelho dessas rotas, só que para quem está autenticado no
 * painel (profissional vendo o próprio aparelho, ou TI).
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
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Garante que quem chama é dono do aparelho ou TI, e devolve o aparelho. */
async function requireDeviceAccess(
  db: Awaited<ReturnType<typeof admin>>,
  deviceId: string,
  context: { supabase: any; userId: string },
) {
  const { data: device } = await db
    .from("devices")
    .select("id, owner_user_id")
    .eq("id", deviceId)
    .maybeSingle();
  if (!device) throw new Error("Aparelho não encontrado.");

  if (device.owner_user_id === context.userId) return device;

  const { data: isTi } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "ti",
  });
  if (isTi !== true) throw new Error("Você não tem acesso a este aparelho.");
  return device;
}

/**
 * URL assinada (curtíssima, 10s) para o último frame enviado pelo aparelho.
 * O painel chama isso em polling (ver PhoneMirror em painel.tsx) enquanto
 * uma sessão está ativa. `found: false` quando o aparelho ainda não mandou
 * nenhum frame (ex.: acabou de pedir a permissão de captura de tela).
 */
export const getDeviceFrameUrl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    parseInput(z.object({ deviceId: z.string().uuid("Identificador de aparelho inválido.") }), input),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();
    await requireDeviceAccess(db, data.deviceId, context);

    const { data: signed, error } = await db.storage
      .from("device-frames")
      .createSignedUrl(`${data.deviceId}.jpg`, 10);
    if (error || !signed) return { found: false as const, url: null };

    return { found: true as const, url: signed.signedUrl };
  });

/**
 * O painel chama isso a cada toque/arraste feito sobre o frame (modo
 * "controle"). Coordenadas são normalizadas (0 a 1) porque o painel não
 * conhece a resolução real do aparelho - ver input.ts do lado do agente.
 */
export const sendDeviceInput = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    parseInput(
      z
        .object({
          deviceId: z.string().uuid("Identificador de aparelho inválido."),
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
  .handler(async ({ data, context }) => {
    const db = await admin();
    await requireDeviceAccess(db, data.deviceId, context);

    const { data: session } = await db
      .from("access_sessions")
      .select("id")
      .eq("device_id", data.deviceId)
      .eq("status", "ativa")
      .eq("mode", "controle")
      .maybeSingle();
    if (!session)
      throw new Error("Não há sessão em modo controle ativa para este aparelho no momento.");

    const { error } = await db.from("session_inputs").insert({
      session_id: session.id,
      device_id: data.deviceId,
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
