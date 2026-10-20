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
 * Fluxo de 2 toques pra instalar, sem digitar nada: no 1º toque (app ainda
 * não instalado), o Android não tem quem abra o link "meucelular://ativar" e
 * cai no fallback, que é ESTA página — a pessoa baixa e instala o .apk
 * normalmente. Depois de instalado, reabrir o MESMO link faz o Android abrir
 * direto dentro do app já com o token — ver o intent-filter de
 * "meucelular://ativar" no AndroidManifest.xml.
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

  // Tenta abrir o app já instalado, passando o token direto. Se não houver
  // app instalado para tratar o link, o navegador ignora silenciosamente e
  // a pessoa só vê a página normal abaixo - nada quebra nesse caso.
  useEffect(() => {
    if (data?.status !== "pendente") return;
    const isAndroid = /Android/i.test(navigator.userAgent);
    if (!isAndroid) return;

    const fallback = encodeURIComponent(window.location.href);
    const intentUrl =
      `intent://ativar?token=${encodeURIComponent(token)}` +
      `#Intent;scheme=meucelular;package=${ANDROID_PACKAGE};S.browser_fallback_url=${fallback};end`;

    window.location.href = intentUrl;
  }, [data?.status, token]);

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

              <div className="mt-4 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-xs text-foreground">
                Confirme que você está abrindo esta página no navegador do próprio celular que quer
                poder acessar remotamente — não em outro computador.
              </div>

              <ol className="mt-5 space-y-2 text-sm text-muted-foreground">
                <li>1. Marque o aceite e toque em "Baixar e ativar app de gestão" abaixo.</li>
                <li>
                  2. Instale o arquivo baixado (o Android vai pedir para autorizar instalação de
                  fora da Play Store — é esperado, e só precisa autorizar uma vez).
                </li>
                <li>
                  3. Depois de instalado, toque neste mesmo link de novo (ex: na notificação de
                  download): o app abre sozinho já ativado, e este link vira o acesso remoto ao
                  aparelho.
                </li>
              </ol>

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
                <a href={APK_URL} download>
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
