import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Página do LINK DE INSTALAÇÃO — aberta NO PRÓPRIO CELULAR que vai ser
 * gerenciado. O token aqui é o enrollment_token (vai no celular).
 *
 * Decisão de 27/11/2026: instalar e acessar viraram DOIS links separados.
 * Esta página só INSTALA e ATIVA o app. O acesso remoto (ver/controlar a
 * tela) fica no OUTRO link, /acesso/<access_token>, que o TI guarda e não
 * é exposto no aparelho. Antes o mesmo link fazia as duas coisas, o que
 * confundia a jornada e deixava o segredo de acesso dentro do celular.
 *
 * Sem login: a autenticação é a posse do token. A leitura de nome/status usa
 * o endpoint público /api/public/agent/device-info (keyed pelo
 * enrollment_token). A ativação de verdade é feita pelo app, no enrollment.
 */
export const Route = createFileRoute("/instalar/$token")({
  head: () => ({
    meta: [
      { title: "Instalar no celular" },
      { name: "description", content: "Instalação do app de gestão no celular corporativo." },
    ],
  }),
  component: InstalarPage,
});

interface DeviceInfo {
  name: string;
  model: string;
  professionalName: string | null;
  status: "pendente" | "ativo" | "revogado";
}

const ANDROID_PACKAGE = "com.employeeexperience.meucelular";
const APK_URL = "/app/meu-celular-agente.apk";
const APK_SIZE_LABEL = "5,7 MB";

async function fetchDeviceInfo(token: string): Promise<DeviceInfo> {
  const res = await fetch(`/api/public/agent/device-info?token=${encodeURIComponent(token)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? "Link inválido ou já usado.");
  return body as DeviceInfo;
}

function InstalarPage() {
  const { token } = Route.useParams();

  const { data, isLoading, error } = useQuery<DeviceInfo>({
    queryKey: ["device-install", token],
    queryFn: () => fetchDeviceInfo(token),
    retry: false,
    // Enquanto pendente, a ativação acontece no app Android (fora desta aba).
    // Conferir sozinho a cada 4s deixa a tela de "ativado" aparecer sem recarregar.
    refetchInterval: (query) => (query.state.data?.status === "pendente" ? 4_000 : false),
  });

  // Detecta a transição pendente → ativo enquanto a página está aberta no
  // celular, para mostrar a confirmação de ativação uma vez.
  const previousStatus = useRef<DeviceInfo["status"] | null>(null);
  const [showActivatedTransition, setShowActivatedTransition] = useState(false);
  useEffect(() => {
    if (!data) return undefined;
    if (previousStatus.current === "pendente" && data.status === "ativo") {
      setShowActivatedTransition(true);
      const timer = setTimeout(() => setShowActivatedTransition(false), 2500);
      return () => clearTimeout(timer);
    }
    previousStatus.current = data.status;
    return undefined;
  }, [data?.status]);

  // "novo" = celular recém-resetado (vira dono do aparelho, ganha todos os
  // comandos); "em_uso" = celular que já tem conta/apps (ativa com ver/
  // controlar, sem bloquear/reiniciar/apagar). Só muda o texto-guia.
  const [deviceCondition, setDeviceCondition] = useState<"novo" | "em_uso">("novo");

  // Aceite explícito antes de baixar o app: fica na auditoria do aparelho.
  const [accepted, setAccepted] = useState(false);
  function handleAcceptChange(checked: boolean) {
    setAccepted(checked);
    if (!checked) return;
    fetch("/api/public/agent/device-info", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => {
      // Falha de rede aqui não impede a instalação — o registro definitivo
      // da ativação é feito pelo app, no enrollment.
    });
  }

  // Ao tocar em "Baixar", copia o link de ATIVAÇÃO (o próprio /instalar/<token>)
  // para a área de transferência. O app lê esse link e já vem preenchido.
  function copyActivationLink() {
    try {
      navigator.clipboard?.writeText(`${window.location.origin}/instalar/${token}`).catch(() => {});
    } catch {
      // Navegador sem API de área de transferência: o app aceita colar à mão.
    }
  }

  const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

  function openInApp() {
    const fallback = encodeURIComponent(window.location.href);
    const intentUrl =
      `intent://ativar?token=${encodeURIComponent(token)}` +
      `#Intent;scheme=meucelular;package=${ANDROID_PACKAGE};S.browser_fallback_url=${fallback};end`;
    window.location.href = intentUrl;
  }

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
                A gestão deste aparelho foi revogada. Fale com o time de TI se ainda precisar
                instalar de novo.
              </p>
            </div>
          )}

          {data && data.status === "ativo" && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-3xl text-primary">
                ✓
              </div>
              <p className="font-display text-lg text-card-foreground">
                {showActivatedTransition ? "Aparelho ativado" : "Aparelho já está ativo"}
              </p>
              <p className="text-sm text-muted-foreground">
                {data.name} está sob gestão. A instalação neste celular terminou — pode fechar esta
                página.
              </p>
              <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                O acesso remoto (ver a tela) é feito pelo <strong>link de acesso</strong>, que fica
                com o time de TI. Este link de instalação não dá acesso à tela.
              </p>
            </div>
          )}

          {data && data.status === "pendente" && (
            <>
              <h1 className="font-display text-xl text-card-foreground">
                Instalar o app de gestão neste celular
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
                      gerenciar o aparelho, aceite.
                    </li>
                  </ol>
                </>
              ) : (
                <>
                  <div className="mt-4 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-xs text-foreground">
                    Para um celular que já está em uso (com conta Google, apps e dados): ele é
                    ativado e poderá ter a tela <strong>vista e controlada</strong> pelo link de
                    acesso. Bloquear, reiniciar e apagar remotos <strong>não</strong> ficam
                    disponíveis neste caso — isso só em celular resetado. Abra esta página no
                    navegador do próprio celular.
                  </div>
                  <ol className="mt-5 space-y-2 text-sm text-muted-foreground">
                    <li>1. Marque o aceite e toque em "Baixar e ativar app de gestão" abaixo.</li>
                    <li>
                      2. Instale o arquivo baixado (o Android vai pedir para autorizar instalação de
                      fora da Play Store — é esperado, e só precisa autorizar uma vez).
                    </li>
                    <li>
                      3. Abra o app: o link de ativação já vem preenchido. Toque em "Ativar este
                      aparelho". Como o celular já está em uso, ele é ativado sem virar "dono do
                      aparelho".
                    </li>
                    <li>
                      4. Para <strong>controlar</strong> a tela (não só ver), o próprio app mostra o
                      passo para ligar a Acessibilidade nas Configurações do Android.
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
