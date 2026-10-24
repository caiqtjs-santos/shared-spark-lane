import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/lib/backend/auth-middleware";
import { callGateway } from "@/lib/backend/gateway.server";
import { z } from "zod";

const sixDigits = z.string().regex(/^\d{6}$/, "O código precisa ter exatamente 6 dígitos numéricos.");

/**
 * Valida `input` contra `schema` e devolve uma mensagem de erro legível (em vez do
 * ZodError cru, cujo `.message` é um JSON de issues como `{"code":"invalid_string",...}`).
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
 * NOTA (decisão de 24/10/2026, ver roadmap.md): as operações privilegiadas
 * (escrita com service_role) saíram daqui e foram para a Edge Function
 * "gateway" do Supabase (supabase/functions/gateway), que o Supabase injeta
 * a chave sozinho. Estas funções agora só validam a entrada e repassam a
 * ação para o gateway, encaminhando o JWT do TI. `getWorkspace` continua
 * local porque só LÊ, pelo cliente autenticado do próprio usuário (RLS).
 */

async function isTi(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "ti",
  });
  return data === true;
}

/**
 * Cadastro público do time de TI (tela /auth). Profissionais NÃO têm
 * login (decisão de 20/10/2026 no roadmap.md): usam só o link do aparelho.
 *
 * ATENÇÃO: continua simplificado de propósito (ver "Revisar login/2FA" no
 * roadmap) - qualquer pessoa que abra a tela consegue criar uma conta de TI.
 */
export const createTiAccount = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    parseInput(
      z.object({
        loginCode: sixDigits,
        password: z.string().regex(/^\d{6}$/, "A senha precisa ter exatamente 6 dígitos numéricos."),
        name: z.string().min(2, "O nome precisa ter pelo menos 2 letras.").max(80),
      }),
      input,
    ),
  )
  .handler(async ({ data }) => {
    return callGateway<{ ok: true }>("createTiAccount", {
      loginCode: data.loginCode,
      password: data.password,
      name: data.name,
    });
  });

/** Perfil, papel, aparelhos, sessão ativa e histórico do usuário logado. */
export const getWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const ti = await isTi(context);

    const [profileRes, devicesRes, sessionsRes, auditRes] = await Promise.all([
      supabase.from("profiles").select("id, login_code, name").eq("id", userId).maybeSingle(),
      supabase
        .from("devices")
        .select(
          "id, name, model, enrollment_status, enrollment_token, professional_name, device_owner, last_seen_at, battery_level, enrolled_at, created_at",
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("access_sessions")
        .select("id, device_id, reason, mode, status, started_at, ended_at, requested_by_user_id")
        .order("started_at", { ascending: false })
        .limit(50),
      supabase
        .from("audit_log")
        .select("id, event_type, device_id, session_id, details, created_at")
        .order("created_at", { ascending: false })
        .limit(60),
    ]);

    return {
      role: ti ? ("ti" as const) : ("profissional" as const),
      profile: profileRes.data ?? null,
      devices: devicesRes.data ?? [],
      sessions: sessionsRes.data ?? [],
      audit: auditRes.data ?? [],
    };
  });

/**
 * O TI cadastra o aparelho e recebe UM link. Decisão de 20/10/2026 no
 * roadmap.md: o profissional não tem login - só o nome (texto livre) fica
 * gravado no aparelho. O link (enrollment_token) ativa o aparelho e, depois,
 * dá acesso ao painel remoto, autenticado pela posse do próprio token.
 */
export const registerDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    parseInput(
      z.object({
        deviceName: z.string().min(1, "Informe um nome para o aparelho.").max(80),
        professionalName: z
          .string()
          .trim()
          .min(2, "O nome do profissional precisa ter pelo menos 2 letras.")
          .max(80),
      }),
      input,
    ),
  )
  .handler(async ({ data }) => {
    return callGateway<{
      deviceId: string;
      deviceName: string;
      professionalName: string;
      enrollmentToken: string;
    }>(
      "registerDevice",
      { deviceName: data.deviceName, professionalName: data.professionalName },
      { forwardAuth: true },
    );
  });

/**
 * Ativação manual, SEM o app: marca o aparelho como ativo só no painel. É um
 * recurso de teste para o TI (ex.: conferir as telas quando a instalação do
 * app no celular não é possível) - sem o app instalado não há espelhamento.
 * A ativação de verdade acontece em /api/public/agent/enroll, pelo app.
 */
export const acceptEnrollment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    parseInput(
      z.object({
        deviceId: z.string().uuid("Identificador de aparelho inválido."),
        enrollmentToken: z.string().min(8, "Token de ativação inválido."),
      }),
      input,
    ),
  )
  .handler(async ({ data }) => {
    return callGateway<{ ok: true }>(
      "acceptEnrollment",
      { deviceId: data.deviceId, enrollmentToken: data.enrollmentToken },
      { forwardAuth: true },
    );
  });

/** TI revoga a gestão do aparelho e encerra qualquer sessão aberta. */
export const revokeDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    parseInput(z.object({ deviceId: z.string().uuid("Identificador de aparelho inválido.") }), input),
  )
  .handler(async ({ data }) => {
    return callGateway<{ ok: true }>(
      "revokeDevice",
      { deviceId: data.deviceId },
      { forwardAuth: true },
    );
  });

/** O TI inicia o acesso a um aparelho ativo, com motivo registrado. */
export const startSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    parseInput(
      z.object({
        deviceId: z.string().uuid("Identificador de aparelho inválido."),
        reason: z.string().min(5, "Descreva o motivo do acesso com pelo menos 5 letras.").max(500),
        mode: z.enum(["visualizacao", "controle"]),
      }),
      input,
    ),
  )
  .handler(async ({ data }) => {
    return callGateway<{ sessionId: string; startedAt: string }>(
      "startSession",
      { deviceId: data.deviceId, reason: data.reason, mode: data.mode },
      { forwardAuth: true },
    );
  });

/** Encerra a sessão de acesso. */
export const endSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    parseInput(z.object({ sessionId: z.string().uuid("Identificador de sessão inválido.") }), input),
  )
  .handler(async ({ data }) => {
    return callGateway<{ ok: true }>(
      "endSession",
      { sessionId: data.sessionId },
      { forwardAuth: true },
    );
  });
