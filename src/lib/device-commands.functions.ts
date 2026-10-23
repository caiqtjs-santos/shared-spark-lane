import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/lib/backend/auth-middleware";
import { z } from "zod";

/**
 * Comandos remotos de aparelho (bloquear tela / reiniciar / apagar) - ver
 * decisão de 19/10/2026 no roadmap.md e a migração
 * 20261020010500_device_commands.sql. Lado "painel" (TI); o lado do aparelho
 * é src/routes/api/public/agent/commands.ts.
 */

function parseInput<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(issue?.message || "Dados inválidos.");
  }
  return result.data;
}

async function admin() {
  const { supabaseAdmin } = await import("@/lib/backend/admin.server");
  return supabaseAdmin;
}

async function isTi(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "ti",
  });
  return data === true;
}

/**
 * Só o TI manda comando remoto ao aparelho. `wipe` (apagar tudo, sem volta)
 * exige `confirmWipe: true` TAMBÉM aqui no servidor - o diálogo do painel
 * não é a única barreira contra um clique ou chamada acidental.
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
  .handler(async ({ data, context }) => {
    if (!(await isTi(context)))
      throw new Error("Apenas o time de TI pode mandar comandos para o aparelho.");
    if (data.kind === "wipe" && data.confirmWipe !== true)
      throw new Error("Apagar o aparelho exige confirmação explícita.");

    const db: any = await admin();

    const { data: device } = await db
      .from("devices")
      .select("id, enrollment_status, device_owner")
      .eq("id", data.deviceId)
      .maybeSingle();
    if (!device) throw new Error("Aparelho não encontrado.");
    if (device.enrollment_status !== "ativo")
      throw new Error("Este aparelho não está ativo.");
    // Ver decisão de 23/10/2026 (roadmap.md): só aparelho que virou "dono
    // do aparelho" no enrollment aceita estes comandos - aparelho que já
    // estava em uso (com conta configurada) não consegue isso sem reset de
    // fábrica, então nunca executaria o comando mesmo que a gente mandasse.
    if (!device.device_owner)
      throw new Error(
        "Este aparelho foi ativado sem virar \"dono do aparelho\" (provavelmente já tinha conta " +
          "configurada) - bloquear/reiniciar/apagar remotos não funcionam nele. Só reset de " +
          "fábrica e reativação resolvem isso.",
      );

    // Evita empilhar o mesmo comando por cliques repetidos enquanto o
    // aparelho ainda não buscou o anterior.
    const { data: pending } = await db
      .from("device_commands")
      .select("id")
      .eq("device_id", data.deviceId)
      .eq("kind", data.kind)
      .is("delivered_at", null)
      .limit(1);
    if (pending && pending.length > 0)
      throw new Error("Esse comando já foi enviado e está aguardando o aparelho buscar.");

    const { data: command, error } = await db
      .from("device_commands")
      .insert({
        device_id: data.deviceId,
        kind: data.kind,
        requested_by_user_id: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await db.from("audit_log").insert({
      event_type: "comando_enviado",
      device_id: data.deviceId,
      user_id: context.userId,
      details: { kind: data.kind },
    });

    return { ok: true as const, commandId: command.id as string };
  });
