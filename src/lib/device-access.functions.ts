import { createServerFn } from "@tanstack/react-start";
import { callGateway } from "@/lib/backend/gateway.server";
import { z } from "zod";

/**
 * Acesso do PROFISSIONAL ao próprio aparelho, SEM login (decisão de
 * 20/10/2026 no roadmap.md). A autenticação é a posse do token do link
 * /instalar/<token>. As operações privilegiadas rodam na Edge Function
 * "gateway-link" do Supabase (decisão de 24/10/2026) - aqui só validamos a
 * entrada e repassamos; cada chamada revalida o token no servidor.
 */

function parseInput<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(issue?.message || "Dados inválidos.");
  }
  return result.data;
}

const LINK = { fn: "gateway-link" as const };
const tokenSchema = z.string().min(8, "Link inválido.").max(200, "Link inválido.");

/** Dados do aparelho + sessão ativa (se houver), a partir do token do link. */
export const getDeviceByToken = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => parseInput(z.object({ token: tokenSchema }), input))
  .handler(async ({ data }) => {
    return callGateway<{
      name: string;
      model: string;
      professionalName: string | null;
      status: "pendente" | "ativo" | "revogado";
      batteryLevel: number | null;
      lastSeenAt: string | null;
      activeSession: {
        id: string;
        mode: "visualizacao" | "controle";
        reason: string;
        started_at: string;
      } | null;
    }>("getDevice", { token: data.token }, LINK);
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
    return callGateway<{ sessionId: string; startedAt: string }>(
      "startSession",
      { token: data.token, reason: data.reason, mode: data.mode },
      LINK,
    );
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
    return callGateway<{ ok: true }>(
      "endSession",
      { token: data.token, sessionId: data.sessionId },
      LINK,
    );
  });

/**
 * URL assinada (10s) do último frame da tela. Só é entregue enquanto há
 * sessão ativa: fora dela, `found: false` - assim um frame antigo, de uma
 * sessão que já acabou, nunca fica acessível pelo link.
 */
export const getDeviceFrameUrlByToken = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => parseInput(z.object({ token: tokenSchema }), input))
  .handler(async ({ data }) => {
    return callGateway<{ found: boolean; url: string | null }>(
      "getFrameUrl",
      { token: data.token },
      LINK,
    );
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
    return callGateway<{ ok: true }>(
      "sendInput",
      {
        token: data.token,
        kind: data.kind,
        x: data.x,
        y: data.y,
        x2: data.x2,
        y2: data.y2,
        durationMs: data.durationMs,
      },
      LINK,
    );
  });
