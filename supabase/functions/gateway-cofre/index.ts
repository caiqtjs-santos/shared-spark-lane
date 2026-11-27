// Edge Function "gateway-cofre" — liga o cadastro de pessoas ao cofre
// (Vaultwarden). Mesmo desenho das outras gateways (ver roadmap.md, decisão de
// 24/10/2026): operação privilegiada no Edge Function, o Supabase injeta
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY sozinho.
//
// SEGURANÇA: pública (verify_jwt off), mas cada ação exige JWT de usuário com
// papel 'ti'. O endereço e o token de admin do Vaultwarden ficam em SEGREDOS
// desta função (COFRE_ADMIN_URL, COFRE_ADMIN_TOKEN) — nunca no navegador.
//
// MODO STUB: enquanto o cofre (VPS) não existe, os segredos ficam vazios. Aí a
// função NÃO chama o Vaultwarden: ela só registra a conta na tabela `pessoas` e
// devolve { simulated: true }. Quando o cofre subir, basta cadastrar os dois
// segredos e a MESMA função passa a convidar de verdade — sem mudar o código.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Segredos do cofre (vazios no modo stub):
const COFRE_ADMIN_URL = Deno.env.get("COFRE_ADMIN_URL") ?? "";
const COFRE_ADMIN_TOKEN = Deno.env.get("COFRE_ADMIN_TOKEN") ?? "";

function admin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

class AppError extends Error {}

async function requireTi(db: ReturnType<typeof admin>, authHeader: string | null) {
  const jwt = authHeader?.replace(/^Bearer\s+/i, "")?.trim();
  if (!jwt) throw new AppError("Não autenticado.");
  const { data: userData, error } = await db.auth.getUser(jwt);
  if (error || !userData?.user) throw new AppError("Sessão inválida. Entre de novo.");
  const { data: isTi } = await db.rpc("has_role", {
    _user_id: userData.user.id,
    _role: "ti",
  });
  if (isTi !== true) throw new AppError("Apenas o time de TI pode fazer isso.");
  return userData.user.id;
}

/**
 * Abre uma sessão no painel admin do Vaultwarden e devolve o cookie `VW_ADMIN=<jwt>`.
 *
 * O painel não aceita o token direto nas chamadas: o Vaultwarden (src/api/admin.rs,
 * guarda `AdminToken`) só aceita o cookie VW_ADMIN com um JWT emitido pelo login
 * (POST /admin, formulário `token=<token em texto puro>`). Por isso COFRE_ADMIN_TOKEN
 * é o token em TEXTO PURO, o mesmo que se digita na tela /admin — não o hash argon2
 * que fica no .env do servidor.
 */
async function loginAdminCofre(base: string): Promise<string> {
  const res = await fetch(`${base}/admin`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: COFRE_ADMIN_TOKEN }).toString(),
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const jwt = /VW_ADMIN=([^;]+)/.exec(setCookie)?.[1];
  if (!jwt) {
    if (res.status === 429) {
      throw new AppError("O cofre bloqueou por excesso de tentativas. Tente em alguns minutos.");
    }
    throw new AppError(
      "O cofre não aceitou o token de admin. Confira o segredo COFRE_ADMIN_TOKEN (texto puro, não o hash).",
    );
  }
  return `VW_ADMIN=${jwt}`;
}

/**
 * Convida uma pessoa para o cofre. Se os segredos do Vaultwarden não estiverem
 * configurados (modo stub), só registra a conta e devolve simulated=true.
 */
async function inviteToCofre(
  db: ReturnType<typeof admin>,
  payload: { pessoaId?: string; email?: string },
  tiUserId: string,
) {
  const pessoaId = (payload.pessoaId ?? "").trim();
  const email = (payload.email ?? "").trim().toLowerCase();
  if (!pessoaId) throw new AppError("pessoaId é obrigatório.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new AppError("Informe um e-mail válido para a conta do cofre.");
  }

  // Confere que a pessoa existe.
  const { data: pessoa, error: pErr } = await db
    .from("pessoas")
    .select("id, nome")
    .eq("id", pessoaId)
    .maybeSingle();
  if (pErr) throw new AppError("Erro ao ler a pessoa: " + pErr.message);
  if (!pessoa) throw new AppError("Pessoa não encontrada.");

  let simulated = true;
  if (COFRE_ADMIN_URL && COFRE_ADMIN_TOKEN) {
    // Cofre configurado: convida de verdade no Vaultwarden.
    const base = COFRE_ADMIN_URL.replace(/\/$/, "");
    const sessao = await loginAdminCofre(base);
    const res = await fetch(`${base}/admin/invite`, {
      method: "POST",
      headers: { "content-type": "application/json", Cookie: sessao },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new AppError(`O cofre recusou o convite (${res.status}). ${txt}`.trim());
    }
    simulated = false;
  }

  // Registra a conta do cofre na pessoa (os dois modos fazem isto).
  const { error: uErr } = await db
    .from("pessoas")
    .update({ cofre_conta: email })
    .eq("id", pessoaId);
  if (uErr) throw new AppError("Convite feito, mas não salvou a conta: " + uErr.message);

  // Auditoria (LGPD): registra quem concedeu acesso ao cofre e para quem.
  await db.from("audit_log").insert({
    event_type: "cofre_convite",
    user_id: tiUserId,
    details: { pessoaId, cofre_conta: email, simulated },
  });

  return { pessoaId, cofreConta: email, simulated };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  let action = "";
  let payload: Record<string, unknown> = {};
  try {
    const body = (await req.json()) as { action?: string; payload?: Record<string, unknown> };
    action = body.action ?? "";
    payload = body.payload ?? {};
  } catch {
    return json({ error: "Corpo inválido." }, 400);
  }

  const db = admin();
  try {
    const tiUserId = await requireTi(db, req.headers.get("authorization"));
    switch (action) {
      case "health":
        return json({ data: { ok: true, cofreConfigurado: Boolean(COFRE_ADMIN_URL) } });
      case "inviteToCofre":
        return json({
          data: await inviteToCofre(db, payload as { pessoaId?: string; email?: string }, tiUserId),
        });
      default:
        return json({ error: `Ação desconhecida: ${action}` }, 400);
    }
  } catch (e) {
    const msg = e instanceof AppError ? e.message : "Erro interno.";
    const status = e instanceof AppError ? 400 : 500;
    return json({ error: msg }, status);
  }
});
