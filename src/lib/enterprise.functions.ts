import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/lib/backend/auth-middleware";
import { callGateway } from "@/lib/backend/gateway.server";
import { z } from "zod";
import {
  createSignupUrl,
  completeEnterpriseSignup,
  ensureDefaultPolicy,
  createEnrollmentToken,
  diagnoseCredentials,
} from "./android-management.server";

/**
 * Android Enterprise (caminho avançado de provisionamento por QR). As
 * chamadas ao Google (criar enterprise, política, token de matrícula)
 * continuam rodando aqui no servidor Nitro, pois usam as credenciais do
 * Google (ANDROID_MANAGEMENT_SA_JSON / GOOGLE_CLOUD_PROJECT_ID). Só o acesso
 * ao banco (ler/gravar enterprise_config e devices) foi para a Edge Function
 * "gateway" (decisão de 24/10/2026), para não depender mais do segredo
 * service_role manual do Lovable.
 */

function parseInput<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(issue?.message || "Dados inválidos.");
  }
  return result.data;
}

type EnterpriseConfig = {
  enterpriseName: string | null;
  defaultPolicyName: string | null;
  pendingState: string | null;
  pendingSignupUrlName: string | null;
};

/**
 * Pré-checagem rápida de papel TI feita com o cliente autenticado (RLS). É
 * só um atalho para falhar cedo (e não disparar chamada ao Google por quem
 * não é TI); a Edge Function "gateway" revalida o papel em cada operação de
 * banco.
 */
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
    const config = await callGateway<EnterpriseConfig>("getEnterpriseConfig", {}, { forwardAuth: true });
    return {
      configured: Boolean(config.enterpriseName && config.defaultPolicyName),
      enterpriseName: config.enterpriseName,
    };
  });

/**
 * Checagem rápida (sem chamar o Google) de ANDROID_MANAGEMENT_SA_JSON e
 * GOOGLE_CLOUD_PROJECT_ID. O painel chama isso assim que o TI abre a aba,
 * pra avisar de erro de configuração ANTES de mandar ele pro cadastro
 * hospedado do Google - descobrir só depois de ir e voltar de lá é tarde.
 */
export const checkAndroidCredentials = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireTi(context);
    return diagnoseCredentials();
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

    const state = crypto.randomUUID();
    const callbackUrl = `${data.callbackBaseUrl.replace(/\/$/, "")}/ti/enterprise-callback?state=${state}`;
    const signup = await createSignupUrl(callbackUrl);

    await callGateway(
      "saveEnterprisePending",
      { state, signupUrlName: signup.name },
      { forwardAuth: true },
    );

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

    const config = await callGateway<EnterpriseConfig>("getEnterpriseConfig", {}, { forwardAuth: true });

    if (!config.pendingState || config.pendingState !== data.state) {
      throw new Error(
        "Este retorno não corresponde a um cadastro em andamento (state não confere). Inicie o cadastro novamente.",
      );
    }
    if (!config.pendingSignupUrlName) {
      throw new Error("Cadastro em andamento sem signupUrlName registrado - inicie de novo.");
    }

    const enterprise = await completeEnterpriseSignup({
      signupUrlName: config.pendingSignupUrlName,
      enterpriseToken: data.enterpriseToken,
      displayName: "Meu Celular",
    });

    const policy = await ensureDefaultPolicy(enterprise.name);

    await callGateway(
      "saveEnterpriseConfigured",
      { enterpriseName: enterprise.name, policyName: policy.name },
      { forwardAuth: true },
    );

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

    const config = await callGateway<EnterpriseConfig>("getEnterpriseConfig", {}, { forwardAuth: true });
    if (!config.enterpriseName || !config.defaultPolicyName) {
      throw new Error("Configure o Android Enterprise antes de gerar um QR de provisionamento.");
    }

    // Confere que o aparelho existe (a função lança se não existir).
    await callGateway("getDeviceStatus", { deviceId: data.deviceId }, { forwardAuth: true });

    const token = await createEnrollmentToken({
      enterpriseName: config.enterpriseName,
      policyName: config.defaultPolicyName,
      deviceId: data.deviceId,
      // 1 hora é suficiente para o TI provisionar o aparelho na hora; gerar
      // de novo é rápido caso expire.
      durationSeconds: 3600,
    });

    await callGateway(
      "saveDeviceQr",
      {
        deviceId: data.deviceId,
        tokenName: token.name,
        tokenValue: token.value,
        qrPng: token.qrCodePngBase64,
        expiresAt: token.expirationTimestamp,
      },
      { forwardAuth: true },
    );

    return {
      qrCodePngBase64: token.qrCodePngBase64,
      expiresAt: token.expirationTimestamp as string,
    };
  });
