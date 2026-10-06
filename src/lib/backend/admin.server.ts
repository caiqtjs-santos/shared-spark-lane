import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { BACKEND_URL, createBackendFetch } from "./config";

/** Nome do segredo (Lovable → More → Cloud → Secrets) com a chave secreta do banco. */
const SERVICE_ROLE_SECRET_NAME = "MEUCELULAR_SERVICE_ROLE_KEY";

/**
 * Cliente do servidor com a chave secreta (service_role) do banco próprio -
 * ignora o RLS. Só para operações confiáveis dentro de server functions e
 * rotas de servidor; nunca chega ao navegador.
 *
 * A chave vem do segredo MEUCELULAR_SERVICE_ROLE_KEY, cadastrado em
 * Lovable → More → Cloud → Secrets. Não dá para usar o nome
 * SUPABASE_SERVICE_ROLE_KEY: o Lovable reserva o prefixo `SUPABASE_` e
 * preenche essa variável com a chave do banco do Lovable Cloud, que o banco
 * próprio recusa.
 *
 * Carregue dentro dos handlers:
 *   const { supabaseAdmin } = await import("@/lib/backend/admin.server");
 */
function createAdminClient() {
  const serviceRoleKey = process.env[SERVICE_ROLE_SECRET_NAME]?.trim();

  if (!serviceRoleKey) {
    const message =
      `Falta cadastrar a chave secreta do banco. No Lovable, abra More → Cloud → Secrets, ` +
      `clique em "Add secret" e crie ${SERVICE_ROLE_SECRET_NAME} com a chave secreta ` +
      `(service_role / "sb_secret_...") do projeto no Supabase.`;
    console.error(`[backend] ${message}`);
    throw new Error(message);
  }

  return createClient<Database>(BACKEND_URL, serviceRoleKey, {
    global: {
      fetch: createBackendFetch(serviceRoleKey),
    },
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

let _supabaseAdmin: ReturnType<typeof createAdminClient> | undefined;

export const supabaseAdmin = new Proxy({} as ReturnType<typeof createAdminClient>, {
  get(_, prop, receiver) {
    if (!_supabaseAdmin) _supabaseAdmin = createAdminClient();
    return Reflect.get(_supabaseAdmin, prop, receiver);
  },
});
