import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * O app Android troca o token de ativação por um segredo permanente do
 * aparelho. Corresponde ao "único aceite" do onboarding.
 *
 * O token NÃO é apagado: depois da ativação ele continua sendo o link
 * permanente do profissional (/instalar/<token> abre o painel de acesso
 * remoto - decisão de 20/10/2026). Para esse link não virar uma forma de
 * roubar o aparelho, a troca por device_secret só vale UMA vez: com o
 * aparelho já ativo, um novo enrollment é recusado.
 *
 * A gravação privilegiada roda na Edge Function "gateway-agent" (decisão de
 * 24/10/2026): aqui só validamos a entrada e repassamos.
 */
export const Route = createFileRoute("/api/public/agent/enroll")({
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
            enrollmentToken: z.string().min(8),
            model: z.string().max(80).optional(),
            pushToken: z.string().max(500).optional(),
            // Resolução real da tela (px) - usada só para converter o toque
            // normalizado (0..1) que o painel manda de volta em coordenadas
            // de pixel reais (ver RemoteAccessibilityService). Não cobre
            // rotação de tela em tempo real.
            screenWidth: z.number().int().positive().max(20000).optional(),
            screenHeight: z.number().int().positive().max(20000).optional(),
            // Ver decisão de 23/10/2026 (roadmap.md) e migração
            // 20261023013000_device_owner_column.sql: só true quando o
            // Android concedeu "dono do aparelho" a este app neste
            // enrollment - decide se o painel pode mandar bloquear/
            // reiniciar/apagar remotamente neste aparelho.
            deviceOwner: z.boolean().optional(),
          })
          .safeParse(body);
        if (!parsed.success)
          return new Response(JSON.stringify({ error: "Dados inválidos" }), {
            status: 400,
            headers: { "content-type": "application/json; charset=utf-8" },
          });

        return callAgentGateway(request, "enroll", parsed.data);
      },
    },
  },
});
