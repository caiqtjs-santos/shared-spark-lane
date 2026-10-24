import { createFileRoute } from "@tanstack/react-router";

/**
 * O app consulta (poll) os comandos administrativos que o TI mandou
 * (bloquear tela / reiniciar / apagar - ver device_commands na migração
 * 20261020010500_device_commands.sql). Mesmo padrão de input.ts: cada
 * chamada já marca como entregues os itens retornados - não há reentrega,
 * então o app precisa executar assim que receber (ver DeviceCommandExecutor).
 *
 * Roda independente de haver sessão de acesso ativa: "aparelho perdido" é
 * exatamente o cenário sem sessão aberta.
 *
 * Autenticado por x-device-id / x-device-secret na Edge Function
 * "gateway-agent" (decisão de 24/10/2026); aqui só repassamos.
 */
export const Route = createFileRoute("/api/public/agent/commands")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { callAgentGateway } = await import("@/lib/backend/gateway.server");
        return callAgentGateway(request, "getCommands", {});
      },
    },
  },
});
