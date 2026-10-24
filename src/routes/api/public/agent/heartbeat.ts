import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * O app informa que está vivo, com nível de bateria e token de notificação.
 * Autenticado por x-device-id / x-device-secret, validados na Edge Function
 * "gateway-agent" (decisão de 24/10/2026); aqui só validamos a entrada.
 */
export const Route = createFileRoute("/api/public/agent/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { callAgentGateway } = await import("@/lib/backend/gateway.server");

        let body: unknown = {};
        try {
          body = await request.json();
        } catch {
          body = {};
        }
        const parsed = z
          .object({
            batteryLevel: z.number().int().min(0).max(100).optional(),
            pushToken: z.string().max(500).optional(),
            // Reportado de novo aqui (além do enroll) porque é só quando a
            // captura de tela realmente começa que o app sabe a resolução
            // com certeza - ver ScreenCaptureService.startCapture.
            screenWidth: z.number().int().positive().max(20000).optional(),
            screenHeight: z.number().int().positive().max(20000).optional(),
          })
          .safeParse(body);
        if (!parsed.success)
          return new Response(JSON.stringify({ error: "Dados inválidos" }), {
            status: 400,
            headers: { "content-type": "application/json; charset=utf-8" },
          });

        return callAgentGateway(request, "heartbeat", parsed.data);
      },
    },
  },
});
