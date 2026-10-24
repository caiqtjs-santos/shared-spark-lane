import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { callGateway } from "@/lib/backend/gateway.server";

/**
 * Consulta pública (sem autenticação) usada pela página de instalação
 * (/instalar/$token) para mostrar qual aparelho está prestes a ser
 * ativado, antes de o profissional confirmar a instalação no próprio
 * celular. Não expõe nada além do necessário para essa confirmação.
 *
 * As operações privilegiadas rodam na Edge Function "gateway-link" do
 * Supabase (decisão de 24/10/2026, ver roadmap.md): o service_role é
 * injetado lá pelo próprio Supabase, sem segredo manual no Lovable.
 */

const LINK = { fn: "gateway-link" as const };

function errorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Devolve o status HTTP certo a partir da mensagem da Edge Function. */
function statusFor(message: string) {
  if (/revogada/i.test(message)) return 403;
  if (/inválido|já usado|não encontrad/i.test(message)) return 404;
  return 400;
}

export const Route = createFileRoute("/api/public/agent/device-info")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const parsed = z
          .object({ token: z.string().min(8) })
          .safeParse({ token: url.searchParams.get("token") });
        if (!parsed.success) return errorResponse("Link inválido", 400);

        try {
          const device = await callGateway<{
            name: string;
            model: string;
            professionalName: string | null;
            status: "pendente" | "ativo" | "revogado";
          }>("getDevice", { token: parsed.data.token }, LINK);
          return new Response(
            JSON.stringify({
              name: device.name,
              model: device.model,
              professionalName: device.professionalName,
              status: device.status,
            }),
            { status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Link inválido ou já usado";
          return errorResponse(msg, statusFor(msg));
        }
      },

      /**
       * Registra o aceite dado na página de instalação (a caixa "Aceito a
       * gestão deste aparelho...") antes de o app ser baixado. Fica na
       * auditoria do aparelho. Vale só para aparelho ainda pendente e é
       * gravado uma única vez por aparelho, para o link não virar um jeito
       * de encher a auditoria de linhas repetidas.
       */
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return errorResponse("Corpo inválido", 400);
        }
        const parsed = z.object({ token: z.string().min(8) }).safeParse(body);
        if (!parsed.success) return errorResponse("Link inválido", 400);

        try {
          const result = await callGateway<{ ok: true }>(
            "registerAceite",
            { token: parsed.data.token },
            LINK,
          );
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Link inválido ou já usado";
          return errorResponse(msg, statusFor(msg));
        }
      },
    },
  },
});
