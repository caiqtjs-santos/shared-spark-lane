import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * O app Android troca o token de ativação por um segredo permanente do
 * aparelho. Corresponde ao "único aceite" do onboarding.
 */
export const Route = createFileRoute("/api/public/agent/enroll")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin, json, logAgentEvent } = await import("@/lib/agent.server");

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: "Corpo inválido" }, 400);
        }

        const parsed = z
          .object({
            enrollmentToken: z.string().min(8),
            model: z.string().max(80).optional(),
            pushToken: z.string().max(500).optional(),
          })
          .safeParse(body);
        if (!parsed.success) return json({ error: "Dados inválidos" }, 400);

        const { data: device } = await supabaseAdmin
          .from("devices")
          .select("id, enrollment_status")
          .eq("enrollment_token", parsed.data.enrollmentToken)
          .maybeSingle();
        if (!device) return json({ error: "Token de ativação inválido" }, 404);
        if (device.enrollment_status === "revogado")
          return json({ error: "Aparelho revogado" }, 403);

        const deviceSecret = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");

        const { error } = await supabaseAdmin
          .from("devices")
          .update({
            enrollment_status: "ativo",
            enrolled_at: new Date().toISOString(),
            device_secret: deviceSecret,
            enrollment_token: null,
            last_seen_at: new Date().toISOString(),
            ...(parsed.data.model ? { model: parsed.data.model } : {}),
            ...(parsed.data.pushToken ? { push_token: parsed.data.pushToken } : {}),
          })
          .eq("id", device.id);
        if (error) return json({ error: error.message }, 500);

        await logAgentEvent({
          event_type: "enrollment_concluido",
          device_id: device.id,
          details: { origem: "app_android" },
        });

        return json({ deviceId: device.id, deviceSecret });
      },
    },
  },
});
