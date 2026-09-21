import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Consulta pública (sem autenticação) usada pela página de instalação
 * (/instalar/$token) para mostrar qual aparelho está prestes a ser
 * ativado, antes de o profissional confirmar a instalação no próprio
 * celular. Não expõe nada além do necessário para essa confirmação.
 */
export const Route = createFileRoute("/api/public/agent/device-info")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { supabaseAdmin, json } = await import("@/lib/agent.server");

        const url = new URL(request.url);
        const parsed = z
          .object({ token: z.string().min(8) })
          .safeParse({ token: url.searchParams.get("token") });
        if (!parsed.success) return json({ error: "Link inválido" }, 400);

        const { data: device } = await supabaseAdmin
          .from("devices")
          .select("name, model, enrollment_status")
          .eq("enrollment_token", parsed.data.token)
          .maybeSingle();

        if (!device) return json({ error: "Link inválido ou já usado" }, 404);
        if (device.enrollment_status === "revogado")
          return json({ error: "Este aparelho teve a gestão revogada." }, 403);

        return json({
          name: device.name,
          model: device.model,
          status: device.enrollment_status,
        });
      },
    },
  },
});
