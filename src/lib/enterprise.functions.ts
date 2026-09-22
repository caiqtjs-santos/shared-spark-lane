import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  createSignupUrl,
  completeEnterpriseSignup,
  ensureDefaultPolicy,
  createEnrollmentToken,
} from "./android-management.server";

function parseInput<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(issue?.message || "Dados inválidos.");
  }
  return result.data;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function requireTi(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "ti",
  });
  if (data !== true) throw new Error("Apenas o time de TI pode gerenciar o Android Enterprise.");
}

/** Estado atual da integração: ainda não configurada, ou já com enterprise criada. */
export const getEnterpriseStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireTi(context);
    const db = await admin();
    const { data } = await db
      .from("enterprise_config")
      .select("enterprise_name, default_policy_name")
      .eq("id", true)
      .maybeSingle();

    return {
      configured: Boolean(data?.enterprise_name && data?.default_policy_name),
      enterpriseName: data?.enterprise_name ?? null,
    };
  });

/**
 * Passo 1: gera a URL de cadastro da enterprise no Google e devolve para o
 * TI abrir numa aba. Guarda um `state` aleatório + o `signupUrlName`
 * devolvido pelo Google na linha singleton, para casar com o retorno no
 * passo 2 (ver completeEnterpriseSignup).
 */
export const startEnterpriseSignup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    parseInput(z.object({ callbackBaseUrl: z.string().url("URL de callback inválida.") }), input),
  )
  .handler(async ({ data, context }) => {
    await requireTi(context);
    const db = await admin();

    const state = crypto.randomUUID();
    const callbackUrl = `${data.callbackBaseUrl.replace(/\/$/, "")}/ti/enterprise-callback?state=${state}`;
    const signup = await createSignupUrl(callbackUrl);

    const { error } = await db.from("enterprise_config").upsert({
      id: true,
      pending_state: state,
      pending_signup_url_name: signup.name,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);

    return { url: signup.url };
  });

/**
 * Passo 2: chamado pela rota de callback (/ti/enterprise-callback) com o
 * `state` (nosso) e o `enterpriseToken` (do Google) que voltaram na URL.
 * Cria a enterprise de verdade e já garante a política padrão dos
 * aparelhos.
 */
export const completeEnterpriseSignupFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    parseInput(
      z.object({
        state: z.string().min(1, "Parâmetro state ausente no retorno do Google."),
        enterpriseToken: z.string().min(1, "Parâmetro enterpriseToken ausente no retorno do Google."),
      }),
      input,
    ),
  )
  .handler(async ({ data, context }) => {
    await requireTi(context);
    const db = await admin();

    const { data: config } = await db
      .from("enterprise_config")
      .select("pending_state, pending_signup_url_name")
      .eq("id", true)
      .maybeSingle();

    if (!config?.pending_state || config.pending_state !== data.state) {
      throw new Error(
        "Este retorno não corresponde a um cadastro em andamento (state não confere). Inicie o cadastro novamente.",
      );
    }
    if (!config.pending_signup_url_name) {
      throw new Error("Cadastro em andamento sem signupUrlName registrado - inicie de novo.");
    }

    const enterprise = await completeEnterpriseSignup({
      signupUrlName: config.pending_signup_url_name,
      enterpriseToken: data.enterpriseToken,
      displayName: "Meu Celular",
    });

    const policy = await ensureDefaultPolicy(enterprise.name);

    const { error } = await db.from("enterprise_config").upsert({
      id: true,
      enterprise_name: enterprise.name,
      default_policy_name: policy.name,
      pending_state: null,
      pending_signup_url_name: null,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);

    return { enterpriseName: enterprise.name as string };
  });

/**
 * Gera o token de matrícula + QR code de provisionamento para UM aparelho
 * já cadastrado. Substitui, para quem usar este fluxo, o link de download
 * do .apk (bloqueado pelo Play Protect) - ver roadmap.md.
 */
export const createDeviceQrProvisioning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    parseInput(z.object({ deviceId: z.string().uuid("Identificador de aparelho inválido.") }), input),
  )
  .handler(async ({ data, context }) => {
    await requireTi(context);
    const db = await admin();

    const { data: config } = await db
      .from("enterprise_config")
      .select("enterprise_name, default_policy_name")
      .eq("id", true)
      .maybeSingle();
    if (!config?.enterprise_name || !config?.default_policy_name) {
      throw new Error("Configure o Android Enterprise antes de gerar um QR de provisionamento.");
    }

    const { data: device } = await db
      .from("devices")
      .select("id, enrollment_status")
      .eq("id", data.deviceId)
      .maybeSingle();
    if (!device) throw new Error("Aparelho não encontrado.");

    const token = await createEnrollmentToken({
      enterpriseName: config.enterprise_name,
      policyName: config.default_policy_name,
      deviceId: data.deviceId,
      // 1 hora é suficiente para o TI provisionar o aparelho na hora; gerar
      // de novo é rápido caso expire.
      durationSeconds: 3600,
    });

    const { error } = await db
      .from("devices")
      .update({
        android_enrollment_token_name: token.name,
        android_enrollment_token_value: token.value,
        android_enrollment_qr_png: token.qrCodePngBase64,
        android_enrollment_expires_at: token.expirationTimestamp,
      })
      .eq("id", data.deviceId);
    if (error) throw new Error(error.message);

    return {
      qrCodePngBase64: token.qrCodePngBase64,
      expiresAt: token.expirationTimestamp as string,
    };
  });
