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
 */
export const Route = createFileRoute("/api/public/agent/input")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { supabaseAdmin, json, authenticateDevice } = await import("@/lib/agent.server");
        const device = await authenticateDevice(request);
        if (!device) return json({ error: "Aparelho não autorizado" }, 401);

        const { data: pending } = await supabaseAdmin
          .from("session_inputs")
          .select("id, kind, x, y, x2, y2, duration_ms")
          .eq("device_id", device.id)
          .is("delivered_at", null)
          .order("created_at", { ascending: true })
          .limit(20);

        if (pending && pending.length > 0) {
          await supabaseAdmin
            .from("session_inputs")
            .update({ delivered_at: new Date().toISOString() })
            .in(
              "id",
              pending.map((p) => p.id),
            );
        }

        return json({
          inputs: (pending ?? []).map((p) => ({
            kind: p.kind,
            x: p.x,
            y: p.y,
            x2: p.x2,
            y2: p.y2,
            durationMs: p.duration_ms,
          })),
        });
      },
    },
  },
});
