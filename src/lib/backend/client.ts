import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { brokeredPreviewStorage } from "@/integrations/supabase/previewAuthStorage";
import { BACKEND_PUBLISHABLE_KEY, BACKEND_URL, createBackendFetch } from "./config";

/**
 * Cliente do navegador (login, sessão) apontando para o banco próprio - ver
 * config.ts para o porquê de não usar o cliente gerado pelo Lovable em
 * src/integrations/supabase/client.ts.
 *
 * Use sempre este, nunca os dois ao mesmo tempo: dois clientes de
 * autenticação na mesma página disputam a mesma sessão.
 */
function createBrowserClient() {
  return createClient<Database>(BACKEND_URL, BACKEND_PUBLISHABLE_KEY, {
    global: {
      fetch: createBackendFetch(BACKEND_PUBLISHABLE_KEY),
    },
    auth: {
      storage: brokeredPreviewStorage(),
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

let _supabase: ReturnType<typeof createBrowserClient> | undefined;

export const supabase = new Proxy({} as ReturnType<typeof createBrowserClient>, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createBrowserClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});
