import { getRequest } from "@tanstack/react-start/server";
import { BACKEND_PUBLISHABLE_KEY, BACKEND_URL } from "./config";

/**
 * Chama a Edge Function "gateway" do Supabase, onde vivem as operações
 * privilegiadas (service_role) do banco. Decisão de 24/10/2026 (ver
 * roadmap.md): o servidor do site (Lovable/Cloudflare Workers) não recebia a
 * chave secreta de forma confiável, então a parte privilegiada foi para uma
 * Edge Function, onde o próprio Supabase injeta SUPABASE_SERVICE_ROLE_KEY
 * automaticamente - sem segredo manual, sem depender do Lovable.
 *
 * A função faz a própria autenticação: ações do TI exigem o JWT do usuário,
 * encaminhado aqui com `forwardAuth`.
 */
const GATEWAY_URL = `${BACKEND_URL}/functions/v1/gateway`;

export async function callGateway<T = unknown>(
  action: string,
  payload: Record<string, unknown>,
  opts: { forwardAuth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    // apikey da chave pública só para passar pelo gateway do Supabase; a
    // autorização de verdade é feita dentro da função (JWT/token/segredo).
    apikey: BACKEND_PUBLISHABLE_KEY,
  };
  if (opts.forwardAuth) {
    const auth = getRequest()?.headers.get("authorization");
    if (auth) headers["Authorization"] = auth;
  }

  let res: Response;
  try {
    res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ action, payload }),
    });
  } catch {
    throw new Error("Não foi possível falar com o servidor do banco. Tente de novo.");
  }

  let body: { data?: T; error?: string };
  try {
    body = (await res.json()) as { data?: T; error?: string };
  } catch {
    body = {};
  }
  if (!res.ok || body.error) {
    throw new Error(body.error || `Falha no servidor (${res.status}).`);
  }
  return body.data as T;
}
