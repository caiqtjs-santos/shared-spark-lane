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
 */
export const Route = createFileRoute("/api/public/agent/commands")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { supabaseAdmin, json, authenticateDevice, logAgentEvent } = await import(
          "@/lib/agent.server"
        );
        const device = await authenticateDevice(request);
        if (!device) return json({ error: "Aparelho não autorizado" }, 401);

        const db: any = supabaseAdmin;
        const { data: pending } = await db
          .from("device_commands")
          .select("id, kind")
          .eq("device_id", device.id)
          .is("delivered_at", null)
          .order("created_at", { ascending: true })
          .limit(5);

        const commands = (pending ?? []) as { id: string; kind: string }[];

        if (commands.length > 0) {
          // O filtro delivered_at is null evita entregar duas vezes se duas
          // consultas simultâneas pegarem os mesmos comandos.
          const { data: claimed } = await db
            .from("device_commands")
            .update({ delivered_at: new Date().toISOString() })
            .in(
              "id",
              commands.map((c) => c.id),
            )
            .is("delivered_at", null)
            .select("id, kind");

          const delivered = (claimed ?? []) as { id: string; kind: string }[];
          for (const c of delivered) {
            await logAgentEvent({
              event_type: "comando_entregue",
              device_id: device.id,
              details: { kind: c.kind },
            });
          }
          const order = new Map(commands.map((c, i) => [c.id, i]));
          delivered.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
          return json({ commands: delivered.map((c) => ({ kind: c.kind })) });
        }

        return json({ commands: [] });
      },
    },
  },
});
