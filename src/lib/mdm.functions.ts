import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { codeToEmail } from "@/lib/login-code";

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

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function isTi(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "ti",
  });
  return data === true;
}

async function logAudit(
  db: any,
  entry: {
    event_type: string;
    device_id?: string | null;
    user_id?: string | null;
    session_id?: string | null;
    details?: Record<string, unknown> | null;
  },
) {
  await db.from("audit_log").insert(entry);
}

/** Seis dígitos aleatórios (com zeros à esquerda), usando o gerador criptográfico. */
function randomSixDigits() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String((buf[0] ?? 0) % 1_000_000).padStart(6, "0");
}

/**
 * Cria um login completo (usuário de autenticação + perfil + papel) pelo
 * servidor, já confirmado. É feito pela API de administração de propósito:
 * o "e-mail" do login é só um endereço interno derivado do código de 6
 * dígitos (ver login-code.ts), então não existe caixa de entrada para
 * confirmar - o cadastro comum pelo navegador falha em projetos que exigem
 * confirmação de e-mail ("Email address ... is invalid").
 */
async function createLogin(
  db: any,
  input: { loginCode: string; password: string; name: string; role: "profissional" | "ti" },
) {
  const { data: taken } = await db
    .from("profiles")
    .select("id")
    .eq("login_code", input.loginCode)
    .maybeSingle();
  if (taken) throw new Error("Esse código de acesso já está em uso. Escolha outro.");

  const { data: created, error: createError } = await db.auth.admin.createUser({
    email: codeToEmail(input.loginCode),
    password: input.password,
    email_confirm: true,
  });
  if (createError || !created?.user) {
    const message = createError?.message ?? "";
    if (/already|registered|exists/i.test(message))
      throw new Error("Esse código de acesso já está em uso. Escolha outro.");
    throw new Error(`Não foi possível criar o login${message ? `: ${message}` : "."}`);
  }
  const userId = created.user.id as string;

  const { error: profileError } = await db
    .from("profiles")
    .insert({ id: userId, login_code: input.loginCode, name: input.name });
  const { error: roleError } = profileError
    ? { error: null }
    : await db.from("user_roles").insert({ user_id: userId, role: input.role });

  if (profileError || roleError) {
    // Não deixa um usuário de autenticação órfão (sem perfil/papel) para trás.
    await db.from("profiles").delete().eq("id", userId);
    await db.auth.admin.deleteUser(userId);
    throw new Error((profileError ?? roleError)?.message ?? "Não foi possível criar o login.");
  }

  return userId;
}

/**
 * Cadastro público do time de TI (tela /auth). Profissionais NÃO se
 * cadastram por aqui: o login deles é criado pelo TI junto com o aparelho
 * (ver registerDevice) e entregue pronto - decisão de 05/10/2026 no
 * roadmap.md.
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
    const db = await admin();

    const userId = await createLogin(db, {
      loginCode: data.loginCode,
      password: data.password,
      name: data.name,
      role: "ti",
    });

    await logAudit(db, {
      event_type: "conta_criada",
      user_id: userId,
      details: { role: "ti" },
    });

    return { ok: true as const };
  });

/** Perfil, papel, aparelhos, sessão ativa e histórico do usuário logado. */
export const getWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const ti = await isTi(context);

    const [profileRes, devicesRes, sessionsRes, auditRes, ownersRes] = await Promise.all([
      supabase.from("profiles").select("id, login_code, name").eq("id", userId).maybeSingle(),
      supabase
        .from("devices")
        .select(
          "id, name, model, enrollment_status, enrollment_token, owner_user_id, last_seen_at, battery_level, enrolled_at, created_at",
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
      // Só o TI enxerga os outros perfis (RLS) - usado para mostrar de quem é
      // cada aparelho na lista. Para o profissional isso nem é consultado.
      ti
        ? supabase.from("profiles").select("id, login_code, name")
        : Promise.resolve({ data: [] as { id: string; login_code: string; name: string }[] }),
    ]);

    return {
      role: ti ? ("ti" as const) : ("profissional" as const),
      profile: profileRes.data ?? null,
      devices: devicesRes.data ?? [],
      sessions: sessionsRes.data ?? [],
      audit: auditRes.data ?? [],
      owners: ownersRes.data ?? [],
    };
  });

/**
 * O TI cadastra o aparelho e já deixa o login do profissional pronto -
 * decisão de 05/10/2026 no roadmap.md: o aparelho é entregue JÁ com o acesso
 * remoto configurado, junto com o login. O TI abre o link gerado aqui no
 * próprio celular (aceite + instalação do app) antes de entregar.
 *
 * Dois casos:
 *  - "novo": cria o login do profissional (código e senha de 6 dígitos
 *    gerados aqui) e devolve os dois para o TI entregar. A senha só aparece
 *    nesta resposta - não fica guardada em lugar nenhum que dê para ler depois.
 *  - "existente": vincula o aparelho a um login que já existe (ex.: troca de
 *    aparelho depois de uma revogação), pelo código de 6 dígitos.
 */
export const registerDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    parseInput(
      z.object({
        deviceName: z.string().min(1, "Informe um nome para o aparelho.").max(80),
        professional: z.discriminatedUnion("kind", [
          z.object({
            kind: z.literal("novo"),
            name: z.string().min(2, "O nome do profissional precisa ter pelo menos 2 letras.").max(80),
          }),
          z.object({ kind: z.literal("existente"), loginCode: sixDigits }),
        ]),
      }),
      input,
    ),
  )
  .handler(async ({ data, context }) => {
    if (!(await isTi(context))) throw new Error("Apenas o time de TI pode cadastrar aparelhos.");
    const db = await admin();

    let owner: { id: string; name: string; loginCode: string };
    let password: string | null = null;

    if (data.professional.kind === "existente") {
      const { data: profile } = await db
        .from("profiles")
        .select("id, name, login_code")
        .eq("login_code", data.professional.loginCode)
        .maybeSingle();
      if (!profile) throw new Error("Não existe login com esse código de acesso.");
      owner = { id: profile.id, name: profile.name, loginCode: profile.login_code };
    } else {
      // Código gerado aqui: tenta alguns até achar um livre (o createLogin
      // recusa código repetido, então colisão só custa uma nova tentativa).
      let loginCode = "";
      for (let attempt = 0; attempt < 10 && !loginCode; attempt++) {
        const candidate = randomSixDigits();
        const { data: taken } = await db
          .from("profiles")
          .select("id")
          .eq("login_code", candidate)
          .maybeSingle();
        if (!taken) loginCode = candidate;
      }
      if (!loginCode) throw new Error("Não foi possível gerar um código de acesso. Tente de novo.");

      password = randomSixDigits();
      const userId = await createLogin(db, {
        loginCode,
        password,
        name: data.professional.name,
        role: "profissional",
      });
      owner = { id: userId, name: data.professional.name, loginCode };

      await logAudit(db, {
        event_type: "conta_criada",
        user_id: userId,
        details: { role: "profissional", criada_pelo_ti: true },
      });
    }

    const enrollmentToken = crypto.randomUUID();
    const { data: device, error } = await db
      .from("devices")
      .insert({
        owner_user_id: owner.id,
        name: data.deviceName,
        // Placeholder - o app Android manda o modelo real (Build.MODEL) no
        // enrollment e sobrescreve isso automaticamente (ver enroll.ts).
        model: "A confirmar na ativação",
        enrollment_status: "pendente",
        enrollment_token: enrollmentToken,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await logAudit(db, {
      event_type: "enrollment_iniciado",
      device_id: device.id,
      user_id: context.userId,
    });

    return {
      deviceId: device.id as string,
      deviceName: data.deviceName,
      enrollmentToken,
      owner: { name: owner.name, loginCode: owner.loginCode },
      // null quando o aparelho foi vinculado a um login que já existia.
      password,
    };
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
  .handler(async ({ data, context }) => {
    const db = await admin();

    const { data: device } = await db
      .from("devices")
      .select("id, owner_user_id, enrollment_token, enrollment_status")
      .eq("id", data.deviceId)
      .maybeSingle();
    if (!device) throw new Error("Aparelho não encontrado.");
    if (!(await isTi(context)))
      throw new Error("Apenas o time de TI pode concluir a ativação manualmente.");
    if (device.enrollment_token !== data.enrollmentToken)
      throw new Error("Token de ativação inválido.");

    const { error } = await db
      .from("devices")
      .update({
        enrollment_status: "ativo",
        enrolled_at: new Date().toISOString(),
        enrolled_by_user_id: context.userId,
      })
      .eq("id", data.deviceId);
    if (error) throw new Error(error.message);

    await logAudit(db, {
      event_type: "enrollment_concluido",
      device_id: data.deviceId,
      user_id: context.userId,
    });

    return { ok: true as const };
  });

/** TI revoga a gestão do aparelho e encerra qualquer sessão aberta. */
export const revokeDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    parseInput(z.object({ deviceId: z.string().uuid("Identificador de aparelho inválido.") }), input),
  )
  .handler(async ({ data, context }) => {
    if (!(await isTi(context))) throw new Error("Apenas o time de TI pode revogar aparelhos.");
    const db = await admin();

    await db
      .from("access_sessions")
      .update({ status: "encerrada", ended_at: new Date().toISOString() })
      .eq("device_id", data.deviceId)
      .eq("status", "ativa");

    const { error } = await db
      .from("devices")
      .update({ enrollment_status: "revogado", device_secret: null })
      .eq("id", data.deviceId);
    if (error) throw new Error(error.message);

    await logAudit(db, {
      event_type: "gestao_revogada",
      device_id: data.deviceId,
      user_id: context.userId,
    });

    return { ok: true as const };
  });

/** O profissional inicia o acesso ao próprio aparelho, com motivo registrado. */
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
  .handler(async ({ data, context }) => {
    const db = await admin();
    const ti = await isTi(context);

    const { data: device } = await db
      .from("devices")
      .select("id, owner_user_id, enrollment_status")
      .eq("id", data.deviceId)
      .maybeSingle();
    if (!device) throw new Error("Aparelho não encontrado.");
    if (!ti && device.owner_user_id !== context.userId)
      throw new Error("Você só pode acessar o próprio aparelho.");
    if (device.enrollment_status !== "ativo")
      throw new Error("Este aparelho ainda não está ativo.");

    const { data: open } = await db
      .from("access_sessions")
      .select("id")
      .eq("device_id", data.deviceId)
      .eq("status", "ativa")
      .maybeSingle();
    if (open) throw new Error("Já existe uma sessão de acesso ativa para este aparelho.");

    const { data: session, error } = await db
      .from("access_sessions")
      .insert({
        device_id: data.deviceId,
        requested_by_user_id: context.userId,
        reason: data.reason,
        mode: data.mode,
        status: "ativa",
      })
      .select("id, started_at")
      .single();
    if (error) throw new Error(error.message);

    await logAudit(db, {
      event_type: "sessao_iniciada",
      device_id: data.deviceId,
      user_id: context.userId,
      session_id: session.id,
      details: { mode: data.mode, reason: data.reason },
    });

    return { sessionId: session.id as string, startedAt: session.started_at as string };
  });

/** Encerra a sessão de acesso. */
export const endSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    parseInput(z.object({ sessionId: z.string().uuid("Identificador de sessão inválido.") }), input),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();
    const ti = await isTi(context);

    const { data: session } = await db
      .from("access_sessions")
      .select("id, device_id, requested_by_user_id, status")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (!session) throw new Error("Sessão não encontrada.");
    if (!ti && session.requested_by_user_id !== context.userId)
      throw new Error("Você só pode encerrar as próprias sessões.");
    if (session.status === "encerrada") return { ok: true as const };

    const { error } = await db
      .from("access_sessions")
      .update({ status: "encerrada", ended_at: new Date().toISOString() })
      .eq("id", data.sessionId);
    if (error) throw new Error(error.message);

    await logAudit(db, {
      event_type: "sessao_encerrada",
      device_id: session.device_id,
      user_id: context.userId,
      session_id: session.id,
    });

    return { ok: true as const };
  });
