import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * O app envia periodicamente (poucos frames por segundo) um JPEG da própria
 * tela, em base64. Guardamos só o ÚLTIMO frame de cada aparelho (sobrescrito
 * a cada chamada, nunca vira histórico) num bucket privado do Storage - ver
 * migração 20261005181500_screen_mirroring.sql para o porquê desse desenho
 * (espelhamento sem WebRTC/TURN, trocando fluidez por simplicidade).
 *
 * Só aceita frame quando existe sessão ativa para o aparelho - fora de
 * sessão, o app nem deveria estar chamando isso (ver SessionWatcherService),
 * mas a checagem (na Edge Function) evita gravar lixo no Storage em qualquer
 * cenário de app desatualizado/bug.
 *
 * Autenticado por x-device-id / x-device-secret na Edge Function
 * "gateway-agent" (decisão de 24/10/2026); aqui só validamos a entrada.
 */
export const Route = createFileRoute("/api/public/agent/frame")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { callAgentGateway } = await import("@/lib/backend/gateway.server");

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "Corpo inválido" }), {
            status: 400,
            headers: { "content-type": "application/json; charset=utf-8" },
          });
        }

        const parsed = z
          .object({
            // JPEG em base64, sem o prefixo "data:image/jpeg;base64,".
            frameBase64: z.string().min(100),
          })
          .safeParse(body);
        if (!parsed.success)
          return new Response(JSON.stringify({ error: "Dados inválidos" }), {
            status: 400,
            headers: { "content-type": "application/json; charset=utf-8" },
          });

        return callAgentGateway(request, "postFrame", parsed.data);
      },
    },
  },
});
