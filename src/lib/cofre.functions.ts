import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/lib/backend/auth-middleware";
import { callGateway } from "@/lib/backend/gateway.server";
import { z } from "zod";

function parseInput<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message || "Dados inválidos.");
  }
  return result.data;
}

/**
 * Convida uma pessoa para o cofre (Vaultwarden). Repassa para a Edge Function
 * "gateway-cofre", que faz a autenticação de TI e fala com o cofre. Enquanto o
 * cofre não existe (segredos não configurados), devolve simulated=true e só
 * registra a conta — a MESMA chamada passa a convidar de verdade quando o cofre
 * subir, sem mudar nada aqui.
 */
export const convidarPessoaCofre = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    parseInput(
      z.object({
        pessoaId: z.string().uuid("Identificador de pessoa inválido."),
        email: z.string().email("Informe um e-mail válido para a conta do cofre."),
      }),
      input,
    ),
  )
  .handler(async ({ data }) => {
    return callGateway<{ pessoaId: string; cofreConta: string; simulated: boolean }>(
      "inviteToCofre",
      { pessoaId: data.pessoaId, email: data.email },
      { forwardAuth: true, fn: "gateway-cofre" },
    );
  });
