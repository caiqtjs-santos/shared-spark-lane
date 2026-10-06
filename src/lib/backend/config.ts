/**
 * Endereço e chave PÚBLICA do banco próprio do projeto (Supabase
 * `brazmbstdzinxgdydxlk`, fora do Lovable Cloud - ver roadmap.md).
 *
 * Ficam fixos aqui, no código, de propósito:
 *  - O Lovable injeta sozinho as variáveis `SUPABASE_*` no servidor, sempre
 *    apontando para o banco do próprio Lovable Cloud, e NÃO deixa
 *    sobrescrevê-las (o prefixo `SUPABASE_` é reservado nos Secrets). Ler
 *    `process.env.SUPABASE_URL` fazia o servidor falar com um banco e o
 *    navegador com outro - o login entrava e o painel nunca carregava.
 *  - Os dois valores abaixo são públicos por natureza (vão para o navegador
 *    de qualquer jeito); quem protege os dados é o RLS, não o sigilo deles.
 *
 * A chave SECRETA (service_role) nunca fica no código: vem do segredo
 * `MEUCELULAR_SERVICE_ROLE_KEY`, cadastrado no Lovable (ver admin.server.ts).
 */
export const BACKEND_URL = "https://brazmbstdzinxgdydxlk.supabase.co";
export const BACKEND_PUBLISHABLE_KEY = "sb_publishable_DHuxuBAhfcbdb0nHkMEwUA_0cdwSCUd";

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

/**
 * `fetch` que manda a chave no cabeçalho `apikey`. As chaves novas do
 * Supabase (`sb_publishable_` / `sb_secret_`) são textos opacos, não JWTs,
 * então não podem ir em `Authorization: Bearer`.
 */
export function createBackendFetch(key: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    }

    if (isNewSupabaseApiKey(key) && headers.get("Authorization") === `Bearer ${key}`) {
      headers.delete("Authorization");
    }

    headers.set("apikey", key);
    return fetch(input, { ...init, headers });
  };
}
