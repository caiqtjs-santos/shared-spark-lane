/**
 * Cliente da Android Management API do Google, usado para o fluxo de
 * Android Enterprise / Managed Google Play (ver roadmap.md e a migração
 * 20260922120000_android_enterprise.sql para o motivo).
 *
 * Escrito sem nenhuma biblioteca Node (google-auth-library, googleapis)
 * de propósito: as server functions deste projeto rodam em runtime de
 * Workers (Cloudflare, via Lovable), que não tem os módulos nativos que
 * essas bibliotecas esperam. A autenticação é feita "na mão": montamos e
 * assinamos um JWT com a chave privada da conta de serviço usando a Web
 * Crypto API (SubtleCrypto), que existe tanto em Workers quanto no Node
 * moderno, e trocamos esse JWT por um access token OAuth2 do Google.
 *
 * A credencial nunca é lida de um arquivo: vem inteira (o JSON da conta de
 * serviço) da variável de ambiente ANDROID_MANAGEMENT_SA_JSON.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://androidmanagement.googleapis.com/v1";
const SCOPE = "https://www.googleapis.com/auth/androidmanagement";

interface ServiceAccountJson {
  client_email: string;
  private_key: string;
  project_id?: string;
}

export interface CredentialsDiagnostics {
  ok: boolean;
  message: string;
}

/**
 * Checagem "offline" das duas variáveis de ambiente que a integração
 * precisa, sem chamar o Google. Existe para o painel conseguir avisar o TI
 * *antes* de ele clicar em "Configurar Android Enterprise" (que já manda
 * pro fluxo hospedado do Google) - erro de configuração só aparecer depois
 * de ir e voltar do Google é tarde e confuso. Também cobre o erro mais
 * comum que já vimos acontecer na prática: colar o Project ID (em vez do
 * conteúdo do arquivo .json baixado) no campo ANDROID_MANAGEMENT_SA_JSON.
 */
export function diagnoseCredentials(): CredentialsDiagnostics {
  const raw = process.env["ANDROID_MANAGEMENT_SA_JSON"];
  const projId = process.env["GOOGLE_CLOUD_PROJECT_ID"];

  if (!raw) {
    return {
      ok: false,
      message:
        "ANDROID_MANAGEMENT_SA_JSON não está configurada. Cadastre nela o conteúdo completo do " +
        "arquivo .json da chave da conta de serviço (Google Cloud → IAM e administrador → Contas " +
        "de serviço → Chaves → Adicionar chave → Criar chave → tipo JSON).",
    };
  }

  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) {
    const preview = trimmed.slice(0, 24);
    return {
      ok: false,
      message:
        `O valor em ANDROID_MANAGEMENT_SA_JSON não é o arquivo JSON da conta de serviço - começa ` +
        `com "${preview}${trimmed.length > 24 ? "..." : ""}", que não é "{". Isso geralmente ` +
        `acontece quando se cola o Project ID (ou outro texto) no lugar do conteúdo inteiro do ` +
        `arquivo .json baixado. Abra esse arquivo, copie tudo (de "{" até "}") e cole aqui.`,
    };
  }

  let parsed: ServiceAccountJson;
  try {
    parsed = JSON.parse(trimmed) as ServiceAccountJson;
  } catch (e) {
    return {
      ok: false,
      message:
        `ANDROID_MANAGEMENT_SA_JSON começa com "{" mas não é um JSON válido ` +
        `(${(e as Error).message}). Confira se o conteúdo não foi cortado ao colar.`,
    };
  }

  if (!parsed.client_email || !parsed.private_key) {
    return {
      ok: false,
      message:
        "O JSON em ANDROID_MANAGEMENT_SA_JSON não tem os campos client_email e/ou private_key. " +
        "Confira se é mesmo o arquivo de chave de conta de serviço (tipo \"service_account\"), e " +
        "não outro arquivo do Google Cloud.",
    };
  }

  if (!projId) {
    return {
      ok: false,
      message: "GOOGLE_CLOUD_PROJECT_ID não está configurada no ambiente.",
    };
  }

  if (parsed.project_id && parsed.project_id !== projId) {
    return {
      ok: false,
      message:
        `GOOGLE_CLOUD_PROJECT_ID está como "${projId}", mas o JSON da conta de serviço pertence ` +
        `ao projeto "${parsed.project_id}". Confira se os dois valores não foram trocados entre si.`,
    };
  }

  return {
    ok: true,
    message: `Credenciais OK - conta de serviço ${parsed.client_email}, projeto ${projId}.`,
  };
}

function readServiceAccount(): ServiceAccountJson {
  const diagnostics = diagnoseCredentials();
  if (!diagnostics.ok) throw new Error(diagnostics.message);
  // diagnoseCredentials() já validou o parse acima; refazer aqui é barato e
  // evita duplicar o tipo de retorno entre as duas funções.
  return JSON.parse((process.env["ANDROID_MANAGEMENT_SA_JSON"] as string).trim()) as ServiceAccountJson;
}

function projectId(): string {
  const id = process.env["GOOGLE_CLOUD_PROJECT_ID"];
  if (!id) throw new Error("GOOGLE_CLOUD_PROJECT_ID não está configurada no ambiente.");
  return id;
}

// --- base64url + assinatura RS256 via Web Crypto (sem Buffer/Node) ---

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlFromString(s: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(s));
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function signJwt(sa: ServiceAccountJson): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${base64UrlFromString(JSON.stringify(header))}.${base64UrlFromString(JSON.stringify(claims))}`;
  const key = await importPrivateKey(sa.private_key);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlFromBytes(new Uint8Array(signature))}`;
}

// Cache em memória do processo/isolate - best effort. Um novo isolate (comum
// em Workers) simplesmente busca um token novo; não há problema em não
// persistir isso em lugar nenhum.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }
  const sa = readServiceAccount();
  const jwt = await signJwt(sa);

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`Falha ao obter access token do Google (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cachedToken.value;
}

async function callApi<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Android Management API (${path}) falhou com ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

// --- Operações de alto nível usadas pelas server functions ---

/**
 * Passo 1 do cadastro da enterprise: gera a URL que o TI abre para criar (ou
 * escolher) a conta gerenciada do Google Play. `callbackUrl` é a URL da
 * NOSSA aplicação para onde o Google redireciona de volta, com
 * `?enterpriseToken=...` anexado — deve incluir um `state` nosso (ver
 * enterprise.functions.ts) para sabermos qual cadastro está voltando.
 */
export async function createSignupUrl(callbackUrl: string): Promise<{ name: string; url: string }> {
  return callApi(
    `signupUrls?projectId=${encodeURIComponent(projectId())}&callbackUrl=${encodeURIComponent(callbackUrl)}`,
    { method: "POST" },
  );
}

/**
 * Passo 2: depois que o Google redireciona de volta com `enterpriseToken`,
 * criamos de fato o recurso "enterprise" (a organização gerenciada) neste
 * projeto do Google Cloud.
 */
export async function completeEnterpriseSignup(params: {
  signupUrlName: string;
  enterpriseToken: string;
  displayName: string;
}): Promise<{ name: string }> {
  return callApi(
    `enterprises?projectId=${encodeURIComponent(projectId())}` +
      `&signupUrlName=${encodeURIComponent(params.signupUrlName)}` +
      `&enterpriseToken=${encodeURIComponent(params.enterpriseToken)}`,
    {
      method: "POST",
      body: JSON.stringify({ enterpriseDisplayName: params.displayName }),
    },
  );
}

/**
 * Cria (ou substitui) a política padrão dos aparelhos gerenciados.
 *
 * Pontos deliberados:
 * - `statusBarDisabled: false` e não removemos a barra de status/nav - o
 *   aviso "Este dispositivo é gerenciado pela sua organização" do próprio
 *   Android em modo "totalmente gerenciado" já satisfaz, de forma nativa e
 *   mais robusta que a nossa notificação custom, o requisito de
 *   consentimento visível permanente durante a gestão.
 * - `applications`: só o nosso app fica instalado automaticamente e como
 *   app essencial (não pode ser desinstalado pelo usuário).
 */
export async function ensureDefaultPolicy(enterpriseName: string): Promise<{ name: string }> {
  const policyName = `${enterpriseName}/policies/default`;
  const policy = {
    applications: [
      {
        packageName: "com.employeeexperience.meucelular",
        installType: "FORCE_INSTALLED",
        defaultPermissionPolicy: "GRANT",
      },
    ],
    statusReportingSettings: {
      applicationReportsEnabled: true,
      deviceSettingsEnabled: true,
      softwareInfoEnabled: true,
    },
    // Mantém o dispositivo utilizável normalmente no dia a dia - só reforça
    // a gestão, não bloqueia o uso pessoal do aparelho.
    factoryResetDisabled: false,
    keyguardDisabled: false,
    debuggingFeaturesAllowed: false,
  };
  return callApi(`${policyName}?updateMask=applications,statusReportingSettings`, {
    method: "PATCH",
    body: JSON.stringify(policy),
  });
}

export interface EnrollmentTokenResult {
  name: string;
  value: string;
  qrCodePngBase64: string;
  expirationTimestamp: string;
}

/**
 * Gera um token de matrícula (e o QR code correspondente) para UM aparelho.
 * `additionalData` carrega o nosso `deviceId` interno, para no futuro
 * conseguirmos casar o aparelho que aparecer do lado da Android Management
 * API com a linha certa em `devices` (via `enterprises.devices.list` ou uma
 * notificação Pub/Sub - ainda não implementado, ver roadmap.md).
 */
export async function createEnrollmentToken(params: {
  enterpriseName: string;
  policyName: string;
  deviceId: string;
  durationSeconds?: number;
}): Promise<EnrollmentTokenResult> {
  const body = {
    policyName: params.policyName,
    duration: `${params.durationSeconds ?? 3600}s`,
    additionalData: JSON.stringify({ deviceId: params.deviceId }),
  };
  const result = await callApi<{
    name: string;
    value: string;
    qrCode: string;
    expirationTimestamp: string;
  }>(`${params.enterpriseName}/enrollmentTokens`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return {
    name: result.name,
    value: result.value,
    qrCodePngBase64: result.qrCode,
    expirationTimestamp: result.expirationTimestamp,
  };
}
