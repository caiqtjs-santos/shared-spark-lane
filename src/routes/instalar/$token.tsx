import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { PhoneMirror, type MirrorSource } from "@/components/device-mirror";
import {
  getDeviceByToken,
  startSessionByToken,
  endSessionByToken,
  getDeviceFrameUrlByToken,
  sendDeviceInputByToken,
} from "@/lib/device-access.functions";
import { toast } from "sonner";

/**
 * Página pública que o link do aparelho aponta para — gerada pelo TI em
 * "Cadastrar aparelho" (ver painel.tsx) e entregue já pronta ao profissional.
 * Decisão de 20/10/2026 (ver roadmap.md): não existe login do profissional.
 * O MESMO link serve para duas coisas, no mesmo token:
 *
 *  1. Enquanto o aparelho está "pendente": fluxo de ativação (baixar e
 *     instalar o app, aceite registrado em auditoria) — precisa ser aberto
 *     NO PRÓPRIO CELULAR que vai ser gerenciado.
 *  2. Assim que o aparelho fica "ativo": a MESMA página vira o painel de
 *     acesso remoto (ver os componentes de device-mirror.tsx) — o
 *     profissional abre o link (de qualquer aparelho/navegador, não precisa
 *     ser o celular gerenciado) e já cai direto no painel, sem digitar nada.
 *
 * Instalar sem digitar nada: a pessoa abre o link, baixa e instala o .apk
 * normalmente nesta página. Depois de instalado, há um botão "abrir no app"
 * que dispara o intent "meucelular://ativar" já com o token (ver o
 * intent-filter no AndroidManifest.xml). A abertura NÃO é automática de
 * propósito: abrir o app sozinho no carregamento, quando ele ainda não existe,
 * caía no fallback (esta página) e virava um laço infinito ("piscando").
 */
export const Route = createFileRoute("/instalar/$token")({
  head: () => ({
    meta: [
      { title: "Meu Celular" },
      {
        name: "description",
        content: "Acesso remoto ao celular corporativo.",
      },
    ],
  }),
  component: InstalarPage,
});

interface DeviceInfo {
  name: string;
  model: string;
  professionalName: string | null;
  status: "pendente" | "ativo" | "revogado";
  batteryLevel: number | null;
  lastSeenAt: string | null;
  activeSession: {
    id: string;
    mode: "visualizacao" | "controle";
    reason: string;
    started_at: string;
  } | null;
}

const ANDROID_PACKAGE = "com.employeeexperience.meucelular";
const APK_URL = "/app/meu-celular-agente.apk";
const APK_SIZE_LABEL = "5,7 MB";

function InstalarPage() {
  const { token } = Route.useParams();
  const qc = useQueryClient();
  const fetchDevice = useServerFn(getDeviceByToken);

  const { data, isLoading, error } = useQuery<DeviceInfo>({
    queryKey: ["device-by-token", token],
    queryFn: () => fetchDevice({ data: { token } }) as Promise<DeviceInfo>,
    retry: false,
    // Enquanto pendente, a ativação acontece no app Android (fora desta
    // aba) — sem isto, quem está vendo esta página só saberia que o
    // aparelho ativou recarregando a página na mão.
    refetchInterval: (query) => (query.state.data?.status === "pendente" ? 4_000 : false),
  });

  // Detecta a transição pendente → ativo enquanto esta página está aberta,
  // pra mostrar a telinha de confirmação uma única vez (ver imagem de
  // referência "Aparelho ativado"). Se a página já abrir com o aparelho
  // ativo (caso normal do profissional usando o link depois), pula direto
  // para o painel, sem a telinha.
  const previousStatus = useRef<DeviceInfo["status"] | null>(null);
  const [showActivatedTransition, setShowActivatedTransition] = useState(false);
  useEffect(() => {
    if (!data) return undefined;
    if (previousStatus.current === "pendente" && data.status === "ativo") {
      setShowActivatedTransition(true);
      const timer = setTimeout(() => setShowActivatedTransition(false), 1800);
      return () => clearTimeout(timer);
    }
    previousStatus.current = data.status;
    return undefined;
  }, [data?.status]);

  // Caminho de instalação (ver roadmap 23/10/2026): "novo" = celular
  // recém-resetado, que vira "dono do aparelho" e ganha todos os comandos;
  // "em_uso" = celular que já tem conta/apps/dados, que ativa com ver/
  // controlar mas SEM bloquear/reiniciar/apagar. Só muda o texto e o guia
  // desta página; o backend trata os dois igual (o device_owner real vem do
  // app no enrollment). Começa em "novo" para não alterar o caminho que já
  // está em produção.
  const [deviceCondition, setDeviceCondition] = useState<"novo" | "em_uso">("novo");

  // Aceite explícito antes de baixar o app: fica registrado na auditoria do
  // aparelho (POST em device-info). O botão de baixar só libera depois.
  const [accepted, setAccepted] = useState(false);
  function handleAcceptChange(checked: boolean) {
    setAccepted(checked);
    if (!checked) return;
    fetch("/api/public/agent/device-info", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => {
      // Falha de rede aqui não impede a instalação - o registro definitivo
      // da ativação é feito pelo app, no enrollment.
    });
  }

  // Ao tocar em "Baixar", copia o link de ativação para a área de
  // transferência. O app, ao abrir pela primeira vez, lê esse link e já vem com
  // o campo preenchido - a pessoa não precisa copiar/colar nada à mão. Precisa
  // rodar dentro do clique (gesto do usuário) para o navegador permitir.
  function copyActivationLink() {
    try {
      navigator.clipboard
        ?.writeText(`${window.location.origin}/instalar/${token}`)
        .catch(() => {
          // Sem permissão de área de transferência: o app ainda aceita colar à mão.
        });
    } catch {
      // Navegador sem API de área de transferência: idem.
    }
  }

  // Abrir o app já instalado (passando o token direto) - SÓ por toque do
  // usuário, nunca automático. A abertura automática no carregamento era o que
  // causava o laço: quando o app não está instalado, o Android cai no
  // browser_fallback_url (ESTA mesma página), que recarregava e redisparava o
  // intent sem parar - a tela ficava "piscando" no Carregando e abrindo aba
  // atrás de aba. Com o botão, se o app não existir o Android apenas volta a
  // mostrar esta página (uma vez), sem laço.
  const isAndroid =
    typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

  function openInApp() {
    const fallback = encodeURIComponent(window.location.href);
    const intentUrl =
      `intent://ativar?token=${encodeURIComponent(token)}` +
      `#Intent;scheme=meucelular;package=${ANDROID_PACKAGE};S.browser_fallback_url=${fallback};end`;
    window.location.href = intentUrl;
  }

  // Fonte de dados do espelho (device-mirror.tsx) autenticada pelo token do
  // link — ver device-access.functions.ts.
  const fetchFrameUrl = useServerFn(getDeviceFrameUrlByToken);
  const sendInput = useServerFn(sendDeviceInputByToken);
  const source: MirrorSource = {
    queryKey: ["device-frame-by-token", token],
    fetchFrameUrl: () => fetchFrameUrl({ data: { token } }),
    sendInput: (input) => sendInput({ data: { token, ...input } }),
  };

  const start = useMutation({
    mutationFn: useServerFn(startSessionByToken),
    onSuccess: () => {
      toast.success("Sessão iniciada. O aparelho vai pedir consentimento.");
      qc.invalidateQueries({ queryKey: ["device-by-token", token] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const stop = useMutation({
    mutationFn: useServerFn(endSessionByToken),
    onSuccess: () => {
      toast.success("Sessão encerrada.");
      qc.invalidateQueries({ queryKey: ["device-by-token", token] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 block text-center font-display text-2xl text-foreground">
          Meu<span className="text-primary">Celular</span>
        </Link>

        <div className="rounded-2xl border border-border bg-card p-8 shadow-lg">
          {isLoading && <p className="text-center text-sm text-muted-foreground">Carregando...</p>}

          {error && (
            <div className="text-center">
              <p className="text-sm text-destructive">{(error as Error).message}</p>
              <p className="mt-2 text-xs text-muted-foreground">Peça ao time de TI um novo link.</p>
            </div>
          )}

          {data && data.status === "revogado" && (
            <div className="text-center">
              <p className="font-display text-lg text-card-foreground">Acesso revogado</p>
              <p className="mt-2 text-sm text-muted-foreground">
                A gestão deste aparelho foi revogada. Fale com o time de TI se ainda precisar de
                acesso remoto.
              </p>
            </div>
          )}

          {data && showActivatedTransition && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-3xl text-primary">
                ✓
              </div>
              <p className="font-display text-lg text-card-foreground">Aparelho ativado</p>
            </div>
          )}

          {data && data.status === "ativo" && !showActivatedTransition && (
            <>
              <h1 className="font-display text-lg text-card-foreground">{data.name}</h1>
              <p className="text-sm text-muted-foreground">
                {data.professionalName ?? "sem profissional informado"}
                {data.batteryLevel != null ? ` · bateria: ${data.batteryLevel}%` : ""}
              </p>
              <PhoneMirror
                source={source}
                deviceName={data.name}
                activeSession={data.activeSession}
                onStart={(input) => start.mutate({ data: { token, ...input } })}
                onEndSession={() =>
                  data.activeSession &&
                  stop.mutate({ data: { token, sessionId: data.activeSession.id } })
                }
                starting={start.isPending}
                stopping={stop.isPending}
              />
            </>
          )}

          {data && data.status === "pendente" && (
            <>
              <h1 className="font-display text-xl text-card-foreground">
                Ativar acesso remoto neste celular
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {data.name} · {data.model}
              </p>

              {isAndroid && (
                <button
                  type="button"
                  onClick={openInApp}
                  className="mt-4 w-full rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-medium text-primary"
                >
                  Já instalou o app neste celular? Toque para abrir
                </button>
              )}

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDeviceCondition("novo")}
                  className={`rounded-lg border px-3 py-2 text-xs transition-colors ${
                    deviceCondition === "novo"
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  Celular novo / resetado
                </button>
                <button
                  type="button"
                  onClick={() => setDeviceCondition("em_uso")}
                  className={`rounded-lg border px-3 py-2 text-xs transition-colors ${
                    deviceCondition === "em_uso"
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  Celular já em uso
                </button>
              </div>

              {deviceCondition === "novo" ? (
                <>
                  <div className="mt-4 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-xs text-foreground">
                    Use um celular recém-resetado, ainda sem nenhuma conta Google configurada, e abra
                    esta página no navegador desse mesmo celular — não em outro computador.
                  </div>

                  <ol className="mt-5 space-y-2 text-sm text-muted-foreground">
                    <li>1. Marque o aceite e toque em "Baixar e ativar app de gestão" abaixo.</li>
                    <li>
                      2. Instale o arquivo baixado (o Android vai pedir para autorizar instalação de
                      fora da Play Store — é esperado, e só precisa autorizar uma vez).
                    </li>
                    <li>
                      3. Abra o app: o link de ativação já vem preenchido (foi copiado quando você
                      baixou). Toque em "Ativar este aparelho". Se o Android pedir confirmação para
                      gerenciar o aparelho, aceite — e este link vira o acesso remoto.
                    </li>
                  </ol>
                </>
              ) : (
                <>
                  <div className="mt-4 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-xs text-foreground">
                    Para um celular que já está em uso (com conta Google, apps e dados): ele é
                    ativado e você poderá <strong>ver e controlar a tela</strong>. Bloquear,
                    reiniciar e apagar remotos <strong>não</strong> ficam disponíveis neste caso —
                    isso só em celular resetado. Abra esta página no navegador do próprio celular.
                  </div>

                  <ol className="mt-5 space-y-2 text-sm text-muted-foreground">
                    <li>1. Marque o aceite e toque em "Baixar e ativar app de gestão" abaixo.</li>
                    <li>
                      2. Instale o arquivo baixado (o Android vai pedir para autorizar instalação de
                      fora da Play Store — é esperado, e só precisa autorizar uma vez).
                    </li>
                    <li>
                      3. Abra o app: o link de ativação já vem preenchido (foi copiado quando você
                      baixou). Toque em "Ativar este aparelho". Como o celular já está em uso, ele é
                      ativado sem virar "dono do aparelho" — e este link vira o acesso remoto.
                    </li>
                    <li>
                      4. Para <strong>controlar</strong> a tela (não só ver), o próprio app vai te
                      mostrar o passo para ligar a Acessibilidade nas Configurações do Android — um
                      passo manual que o Android exige para apps instalados fora da Play Store. Só
                      ver a tela não precisa disso.
                    </li>
                  </ol>
                </>
              )}

              <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
                  checked={accepted}
                  onChange={(e) => handleAcceptChange(e.target.checked)}
                />
                <span>
                  Aceito que este aparelho corporativo seja gerenciado pela empresa e possa ter a
                  tela acessada remotamente, sempre com aviso visível no aparelho e registro em
                  auditoria.
                </span>
              </label>
              {accepted ? (
                <a href={APK_URL} download onClick={copyActivationLink}>
                  <Button className="mt-4 w-full">Baixar e ativar app de gestão</Button>
                </a>
              ) : (
                <Button className="mt-4 w-full" disabled>
                  Baixar e ativar app de gestão
                </Button>
              )}
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Arquivo assinado pela empresa · {APK_SIZE_LABEL}
              </p>
              <p className="mt-1 text-center text-xs text-muted-foreground">
                Ao baixar, o link de ativação é copiado sozinho — não precisa copiar nada.
              </p>
              <p className="mt-3 text-center text-xs text-muted-foreground">
                O Android é quem exige o passo de instalação manual (não dá para pular por design do
                sistema) — mas depois de instalado uma vez, ativar fica em 1 toque.
              </p>

              <div className="mt-5 rounded-lg border border-border bg-muted/40 px-3 py-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">
                  Se o arquivo baixar e desaparecer sozinho
                </p>
                <p className="mt-1">
                  É o Play Protect apagando um app que ele não conhece. No aplicativo Play Store,
                  toque na sua foto → Play Protect → engrenagem, desligue "Melhorar detecção de apps
                  nocivos" e baixe de novo. É um app da própria empresa, autorizado pelo TI.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
