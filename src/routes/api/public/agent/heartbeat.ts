import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/** O app informa que está vivo, com nível de bateria e token de notificação. */
export const Route = createFileRoute("/api/public/agent/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin, json, authenticateDevice } = await import("@/lib/agent.server");

        const device = await authenticateDevice(request);
        if (!device) return json({ error: "Aparelho não autorizado" }, 401);

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
          })
          .safeParse(body);
        if (!parsed.success) return json({ error: "Dados inválidos" }, 400);

        const { error } = await supabaseAdmin
          .from("devices")
          .update({
            last_seen_at: new Date().toISOString(),
            ...(parsed.data.batteryLevel != null
              ? { battery_level: parsed.data.batteryLevel }
              : {}),
            ...(parsed.data.pushToken ? { push_token: parsed.data.pushToken } : {}),
          })
          .eq("id", device.id);
        if (error) return json({ error: error.message }, 500);

        return json({ ok: true });
      },
    },
  },
});
