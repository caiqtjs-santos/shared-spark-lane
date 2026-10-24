import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/lib/backend/auth-middleware";
import { callGateway } from "@/lib/backend/gateway.server";
import { z } from "zod";

/**
 * Lado "painel web" do espelhamento de tela sem WebRTC/TURN (ver
 * src/routes/api/public/agent/{frame,input}.ts e a migração
 * 20261005181500_screen_mirroring.sql para o desenho completo). Este
 * arquivo é o espelho dessas rotas, só que para quem está autenticado no
 * painel (profissional vendo o próprio aparelho, ou TI).
 *
 * O acesso privilegiado roda na Edge Function "gateway" (decisão de
 * 24/10/2026): ela confere que o usuário é o DONO do aparelho ou do TI antes
 * de devolver o frame / aceitar o toque. Aqui só validamos a entrada e
 * repassamos com o JWT do usuário.
 */

function parseInput<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(issue?.message || "Dados inválidos.");
  }
  return result.data;
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
  .handler(async ({ data }) => {
    return callGateway<{ found: boolean; url: string | null }>(
      "getDeviceFrameUrl",
      { deviceId: data.deviceId },
      { forwardAuth: true },
    );
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
  .handler(async ({ data }) => {
    return callGateway<{ ok: true }>(
      "sendDeviceInput",
      {
        deviceId: data.deviceId,
        kind: data.kind,
        x: data.x,
        y: data.y,
        x2: data.x2,
        y2: data.y2,
        durationMs: data.durationMs,
      },
      { forwardAuth: true },
    );
  });
