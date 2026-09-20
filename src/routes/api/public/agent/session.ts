import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * GET: o app pergunta se existe uma sessão de acesso ativa (o que dispara a
 * notificação de consentimento na tela do aparelho).
 * POST: o app encerra a sessão ativa quando a pessoa cancela no celular.
 */
export const Route = createFileRoute("/api/public/agent/session")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { supabaseAdmin, json, authenticateDevice } = await import("@/lib/agent.server");
        const device = await authenticateDevice(request);
        if (!device) return json({ error: "Aparelho não autorizado" }, 401);

        const { data: session } = await supabaseAdmin
          .from("access_sessions")
          .select("id, mode, reason, started_at")
          .eq("device_id", device.id)
          .eq("status", "ativa")
          .maybeSingle();

        return json({ activeSession: session ?? null });
      },
      POST: async ({ request }) => {
        const { supabaseAdmin, json, authenticateDevice, logAgentEvent } = await import(
          "@/lib/agent.server"
        );
        const device = await authenticateDevice(request);
        if (!device) return json({ error: "Aparelho não autorizado" }, 401);

        let body: unknown = {};
        try {
          body = await request.json();
        } catch {
          body = {};
        }
        const parsed = z.object({ action: z.literal("encerrar") }).safeParse(body);
        if (!parsed.success) return json({ error: "Ação inválida" }, 400);

        const { data: session } = await supabaseAdmin
          .from("access_sessions")
          .select("id")
          .eq("device_id", device.id)
          .eq("status", "ativa")
          .maybeSingle();
        if (!session) return json({ ok: true, encerrada: false });

        await supabaseAdmin
          .from("access_sessions")
          .update({ status: "encerrada", ended_at: new Date().toISOString() })
          .eq("id", session.id);

        await logAgentEvent({
          event_type: "sessao_encerrada",
          device_id: device.id,
          session_id: session.id,
          details: { origem: "app_android" },
        });

        return json({ ok: true, encerrada: true });
      },
    },
  },
});
