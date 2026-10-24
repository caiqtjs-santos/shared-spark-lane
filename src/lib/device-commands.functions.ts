import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/lib/backend/auth-middleware";
import { callGateway } from "@/lib/backend/gateway.server";
import { z } from "zod";

/**
 * Comandos remotos de aparelho (bloquear tela / reiniciar / apagar) - ver
 * decisão de 19/10/2026 no roadmap.md e a migração
 * 20261020010500_device_commands.sql. Lado "painel" (TI); o lado do aparelho
 * é src/routes/api/public/agent/commands.ts.
 *
 * A lógica privilegiada (checar papel TI, "dono do aparelho", dedup, inserir
 * comando e auditar) roda na Edge Function "gateway" (decisão de 24/10/2026):
 * aqui só validamos a entrada e repassamos com o JWT do usuário.
 */

function parseInput<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(issue?.message || "Dados inválidos.");
  }
  return result.data;
}

/**
 * Só o TI manda comando remoto ao aparelho (checado na função). `wipe`
 * (apagar tudo, sem volta) exige `confirmWipe: true` TAMBÉM no servidor - o
 * diálogo do painel não é a única barreira contra um clique acidental.
 */
export const issueDeviceCommand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    parseInput(
      z.object({
        deviceId: z.string().uuid("Identificador de aparelho inválido."),
        kind: z.enum(["lock", "reboot", "wipe"], {
          errorMap: () => ({ message: "Comando inválido." }),
        }),
        confirmWipe: z.boolean().optional(),
      }),
      input,
    ),
  )
  .handler(async ({ data }) => {
    return callGateway<{ ok: true; commandId: string }>(
      "issueDeviceCommand",
      { deviceId: data.deviceId, kind: data.kind, confirmWipe: data.confirmWipe },
      { forwardAuth: true },
    );
  });
