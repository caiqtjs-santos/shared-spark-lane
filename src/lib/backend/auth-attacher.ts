import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "./client";

/**
 * Anexa o token da sessão a toda chamada de server function feita pelo
 * navegador. Precisa estar registrado como `functionMiddleware` global em
 * src/start.ts - sem isso o servidor nunca recebe quem está logado.
 */
export const attachBackendAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
);
