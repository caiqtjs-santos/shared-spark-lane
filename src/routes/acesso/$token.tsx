import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
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
 * Página do LINK DE ACESSO (decisão de 27/11/2026). Fica com o dono do link —
 * quem tem este endereço vê e controla o aparelho. É SEPARADA do link de
 * instalação (/instalar/<enrollment_token>, que vai no celular): aqui o token
 * é o access_token, que nunca é exposto no aparelho gerenciado.
 *
 * Sem login: a autenticação é a posse do token (device-access.functions.ts).
 * Abre de qualquer navegador. Enquanto o aparelho não é ativado no celular,
 * mostra o aviso de espera; depois de ativo, vira o painel de espelhamento.
 */
export const Route = createFileRoute("/acesso/$token")({
  head: () => ({
    meta: [
      { title: "Acesso ao celular" },
      { name: "description", content: "Acesso remoto ao celular corporativo." },
    ],
  }),
  component: AcessoPage,
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

function AcessoPage() {
  const { token } = Route.useParams();
  const qc = useQueryClient();
  const fetchDevice = useServerFn(getDeviceByToken);

  const { data, isLoading, error } = useQuery<DeviceInfo>({
    queryKey: ["device-access", token],
    queryFn: () => fetchDevice({ data: { token } }) as Promise<DeviceInfo>,
    retry: false,
    // Enquanto o aparelho não ativou no celular, conferimos sozinho a cada 4s,
    // para o painel abrir assim que a instalação terminar.
    // Pendente: confere rápido até ativar. Ativo: atualiza a cada 10s para
    // refletir online/offline do aparelho e sessão encerrada em outro lugar.
    refetchInterval: (query) => {
      const st = query.state.data?.status;
      if (st === "pendente") return 4_000;
      if (st === "ativo") return 10_000;
      return false;
    },
  });

  const fetchFrameUrl = useServerFn(getDeviceFrameUrlByToken);
  const sendInput = useServerFn(sendDeviceInputByToken);
  const source: MirrorSource = {
    queryKey: ["device-frame-access", token],
    fetchFrameUrl: () => fetchFrameUrl({ data: { token } }),
    sendInput: (input) => sendInput({ data: { token, ...input } }),
  };

  const start = useMutation({
    mutationFn: useServerFn(startSessionByToken),
    onSuccess: () => {
      toast.success("Sessão iniciada. O aparelho vai pedir consentimento.");
      qc.invalidateQueries({ queryKey: ["device-access", token] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const stop = useMutation({
    mutationFn: useServerFn(endSessionByToken),
    onSuccess: () => {
      toast.success("Sessão encerrada.");
      qc.invalidateQueries({ queryKey: ["device-access", token] });
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
              <p className="mt-2 text-xs text-muted-foreground">
                Peça ao time de TI o link de acesso deste aparelho.
              </p>
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

          {data && data.status === "pendente" && (
            <div className="text-center">
              <p className="font-display text-lg text-card-foreground">Aguardando ativação</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {data.name} ainda não foi ativado no celular. Assim que o app for instalado e
                ativado pelo link de instalação, o acesso aparece aqui sozinho.
              </p>
            </div>
          )}

          {data && data.status === "ativo" && (
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
                lastSeenAt={data.lastSeenAt}
              />
            </>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Quem tem este link acessa o aparelho. Não repasse para quem não deve ter acesso.
        </p>
      </div>
    </main>
  );
}
