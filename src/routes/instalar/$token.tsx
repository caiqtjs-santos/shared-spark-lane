import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Página pública que o token de ativação aponta para. Precisa ser aberta
 * NO PRÓPRIO CELULAR que vai ser acessado remotamente — é isso que a
 * torna diferente de um link clicado em qualquer lugar: o app de gestão
 * só existe (ou vai existir) no aparelho onde essa página for aberta.
 *
 * Fluxo de 2 toques, sem digitar nada: no 1º toque (app ainda não
 * instalado), o Android não tem quem abra o link "meucelular://ativar" e
 * cai no fallback, que é ESTA página — a pessoa baixa e instala o .apk
 * normalmente. Depois de instalado, reabrir o MESMO link (ex: pela
 * notificação de download, ou tocando o link de novo) faz o Android abrir
 * direto dentro do app já com o token, sem precisar copiar/colar nada -
 * ver o intent-filter de "meucelular://ativar" no AndroidManifest.xml.
 */
export const Route = createFileRoute("/instalar/$token")({
  head: () => ({
    meta: [
      { title: "Ativar acesso remoto — Meu Celular" },
      {
        name: "description",
        content: "Abra esta página no celular que você quer poder acessar remotamente.",
      },
    ],
  }),
  component: InstalarPage,
});

interface DeviceInfo {
  name: string;
  model: string;
  status: "pendente" | "ativo" | "revogado";
}

const ANDROID_PACKAGE = "com.employeeexperience.meucelular";
const APK_URL = "/app/meu-celular-agente.apk";

function InstalarPage() {
  const { token } = Route.useParams();

  const { data, isLoading, error } = useQuery<DeviceInfo>({
    queryKey: ["device-info", token],
    queryFn: async () => {
      const res = await fetch(`/api/public/agent/device-info?token=${encodeURIComponent(token)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Não foi possível carregar este link.");
      return body;
    },
    retry: false,
  });

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

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 block text-center font-display text-2xl text-foreground">
          Meu<span className="text-primary">Celular</span>
        </Link>

        <div className="rounded-2xl border border-border bg-card p-8 shadow-lg">
          {isLoading && (
            <p className="text-center text-sm text-muted-foreground">Carregando...</p>
          )}

          {error && (
            <div className="text-center">
              <p className="text-sm text-destructive">{(error as Error).message}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Peça ao TI um novo link de ativação.
              </p>
            </div>
          )}

          {data && data.status === "ativo" && (
            <div className="text-center">
              <p className="font-display text-lg text-card-foreground">Já ativado</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Este aparelho já está com a gestão ativa. Não é preciso fazer nada aqui.
              </p>
            </div>
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
                Confirme que você está abrindo esta página no navegador do próprio celular que
                quer poder acessar remotamente — não em outro computador.
              </div>

              <ol className="mt-5 space-y-2 text-sm text-muted-foreground">
                <li>1. Toque em "Baixar app de gestão" abaixo.</li>
                <li>2. Instale o arquivo baixado (o Android vai pedir para autorizar instalação de fora da Play Store — é esperado, e só precisa autorizar uma vez).</li>
                <li>3. Depois de instalado, toque neste mesmo link de novo (ex: na notificação de download): o app abre sozinho já ativado, sem precisar digitar nada.</li>
              </ol>

              <a href={APK_URL} download>
                <Button className="mt-6 w-full">Baixar app de gestão</Button>
              </a>
              <p className="mt-3 text-center text-xs text-muted-foreground">
                O Android é quem exige o passo de instalação manual (não dá para pular por
                design do sistema) — mas depois de instalado uma vez, ativar fica em 1 toque.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
