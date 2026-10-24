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
export async function callGateway<T = unknown>(
  action: string,
  payload: Record<string, unknown>,
  // `fn`: qual Edge Function chamar —
  //  - "gateway": operações do TI, exigem o JWT do usuário (forwardAuth).
  //  - "gateway-link": caminho do profissional, autenticado pelo token no payload.
  //  - "gateway-agent": caminho do app Android, autenticado por x-device-id /
  //    x-device-secret, passados em `extraHeaders`.
  opts: {
    forwardAuth?: boolean;
    fn?: "gateway" | "gateway-link" | "gateway-agent";
    extraHeaders?: Record<string, string>;
  } = {},
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
  if (opts.extraHeaders) Object.assign(headers, opts.extraHeaders);

  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}/functions/v1/${opts.fn ?? "gateway"}`, {
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

function agentJson(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/**
 * Proxy transparente das rotas do app Android (/api/public/agent/*) para a
 * Edge Function "gateway-agent". Encaminha os cabeçalhos de autenticação do
 * aparelho (x-device-id / x-device-secret) e PRESERVA o status HTTP e o
 * formato do corpo que o app já espera: em sucesso devolve o próprio `data`
 * (sem o envelope), em erro devolve `{ error }` com o mesmo status.
 */
export async function callAgentGateway(
  req: Request,
  action: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    apikey: BACKEND_PUBLISHABLE_KEY,
  };
  const deviceId = req.headers.get("x-device-id");
  const deviceSecret = req.headers.get("x-device-secret");
  if (deviceId) headers["x-device-id"] = deviceId;
  if (deviceSecret) headers["x-device-secret"] = deviceSecret;

  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}/functions/v1/gateway-agent`, {
      method: "POST",
      headers,
      body: JSON.stringify({ action, payload }),
    });
  } catch {
    return agentJson({ error: "Não foi possível falar com o servidor." }, 502);
  }

  let body: { data?: unknown; error?: string };
  try {
    body = (await res.json()) as { data?: unknown; error?: string };
  } catch {
    body = {};
  }
  if (!res.ok || body.error) {
    return agentJson({ error: body.error ?? `Falha no servidor (${res.status}).` }, res.ok ? 400 : res.status);
  }
  return agentJson(body.data ?? {}, 200);
}
