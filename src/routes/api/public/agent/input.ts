import { createFileRoute } from "@tanstack/react-router";

/**
 * O app consulta (poll) os toques/arrastos que o painel mandou enquanto a
 * sessão está em modo "controle" (ver session_inputs na migração
 * 20261005181500_screen_mirroring.sql). Cada chamada já marca como
 * entregues os itens retornados - não há reentrega, então o app precisa
 * injetar o gesto assim que receber (ver RemoteAccessibilityService).
 *
 * Coordenadas vêm normalizadas (0 a 1, relativas ao frame mostrado no
 * painel) porque o painel não sabe a resolução real do aparelho - quem
 * converte para pixel é o app, usando devices.screen_width/height
 * reportado no enrollment.
 *
 * Autenticado por x-device-id / x-device-secret na Edge Function
 * "gateway-agent" (decisão de 24/10/2026); aqui só repassamos.
 */
export const Route = createFileRoute("/api/public/agent/input")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { callAgentGateway } = await import("@/lib/backend/gateway.server");
        return callAgentGateway(request, "getInputs", {});
      },
    },
  },
});
