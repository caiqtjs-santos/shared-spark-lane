import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * GET: o app pergunta se existe uma sessão de acesso ativa (o que dispara a
 * notificação de consentimento na tela do aparelho).
 * POST: o app encerra a sessão ativa quando a pessoa cancela no celular.
 *
 * Autenticado por x-device-id / x-device-secret, validados na Edge Function
 * "gateway-agent" (decisão de 24/10/2026); aqui só repassamos.
 */
export const Route = createFileRoute("/api/public/agent/session")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { callAgentGateway } = await import("@/lib/backend/gateway.server");
        return callAgentGateway(request, "getSession", {});
      },
      POST: async ({ request }) => {
        const { callAgentGateway } = await import("@/lib/backend/gateway.server");

        let body: unknown = {};
        try {
          body = await request.json();
        } catch {
          body = {};
        }
        const parsed = z.object({ action: z.literal("encerrar") }).safeParse(body);
        if (!parsed.success)
          return new Response(JSON.stringify({ error: "Ação inválida" }), {
            status: 400,
            headers: { "content-type": "application/json; charset=utf-8" },
          });

        return callAgentGateway(request, "endSession", {});
      },
    },
  },
});
