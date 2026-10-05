import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  getWorkspace,
  createOwnDevice,
  acceptEnrollment,
  revokeDevice,
  startSession,
  endSession,
} from "@/lib/mdm.functions";
import {
  getEnterpriseStatus,
  startEnterpriseSignup,
  createDeviceQrProvisioning,
  checkAndroidCredentials,
} from "@/lib/enterprise.functions";
import { getDeviceFrameUrl, sendDeviceInput } from "@/lib/screen.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/painel")({
  head: () => ({
    meta: [
      { title: "Painel — Meu Celular" },
      {
        name: "description",
        content:
          "Gerencie aparelhos corporativos, inicie sessões de acesso e veja a auditoria completa.",
      },
      { property: "og:title", content: "Painel — Meu Celular" },
      {
        property: "og:description",
        content: "Painel de gestão e acesso remoto de celulares corporativos.",
      },
    ],
  }),
  component: PainelPage,
});

const workspaceQuery = (fn: ReturnType<typeof useServerFn<typeof getWorkspace>>) =>
  queryOptions({ queryKey: ["workspace"], queryFn: () => fn() });

function PainelPage() {
  const navigate = useNavigate();
  const load = useServerFn(getWorkspace);
  const { data, isLoading } = useQuery(workspaceQuery(load));

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  if (isLoading || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Carregando painel...</p>
      </div>
    );
  }

  if (!data.profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md rounded-2xl border border-border bg-card p-8 text-center">
          <p className="text-muted-foreground">
            Sua conta não tem perfil ainda. Saia e crie o acesso novamente.
          </p>
          <Button className="mt-4" onClick={handleSignOut}>
            Sair
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="font-display text-lg">
              Meu<span className="text-primary">Celular</span>
            </h1>
            <p className="text-xs text-muted-foreground">
              {data.profile.name} · código {data.profile.login_code} ·{" "}
              {data.role === "ti" ? "Time de TI" : "Profissional"}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleSignOut}>
            Sair
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {data.role === "ti" ? <TiView data={data} /> : <ProfissionalView data={data} />}
      </main>
    </div>
  );
}

type Workspace = Awaited<ReturnType<typeof getWorkspace>>;

function TiView({ data }: { data: Workspace }) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["workspace"] });

  const [qrByDevice, setQrByDevice] = useState<Record<string, string>>({});

  const enterpriseStatus = useQuery({
    queryKey: ["enterprise-status"],
    queryFn: useServerFn(getEnterpriseStatus),
  });
  // Só roda quando o TI pedir explicitamente (botão "Verificar
  // configuração") - essa etapa do Android Enterprise é opcional por
  // enquanto, então não faz sentido já abrir a tela mostrando um erro de
  // uma integração que ainda não foi configurada de propósito.
  const credentialsCheck = useQuery({
    queryKey: ["android-credentials-check"],
    queryFn: useServerFn(checkAndroidCredentials),
    enabled: false,
    retry: false,
  });
  const startEnterprise = useMutation({
    mutationFn: useServerFn(startEnterpriseSignup),
    onSuccess: (res: { url: string }) => {
      window.location.href = res.url;
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const generateQr = useMutation({
    mutationFn: useServerFn(createDeviceQrProvisioning),
    onError: (e: Error) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: useServerFn(revokeDevice),
    onSuccess: () => {
      toast.success("Gestão revogada.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="rounded-2xl border border-border bg-card p-6 md:col-span-2">
        <div className="mt-1 flex items-center gap-2">
          <h2 className="font-display text-base">Android Enterprise (Managed Google Play)</h2>
          {!enterpriseStatus.isLoading && !enterpriseStatus.data?.configured && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
              Opcional por enquanto
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          O Google Play Protect bloqueia a instalação do app fora de um canal validado. Este modo
          resolve isso: o aparelho é provisionado por QR code em vez de baixar o .apk diretamente.
          {!enterpriseStatus.isLoading && !enterpriseStatus.data?.configured && (
            <>
              {" "}
              Enquanto isso não estiver configurado, cada profissional gera e ativa o próprio
              link manualmente (modo de teste) na própria tela.
            </>
          )}
        </p>
        {enterpriseStatus.isLoading ? (
          <p className="mt-3 text-sm text-muted-foreground">Verificando status...</p>
        ) : enterpriseStatus.data?.configured ? (
          <p className="mt-3 text-sm text-foreground">
            Configurado — <span className="font-mono text-xs">{enterpriseStatus.data.enterpriseName}</span>
          </p>
        ) : (
          <>
            {credentialsCheck.data && !credentialsCheck.data.ok && (
              <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                <p className="text-sm text-destructive">{credentialsCheck.data.message}</p>
              </div>
            )}
            {credentialsCheck.data?.ok && (
              <p className="mt-3 text-xs text-muted-foreground">{credentialsCheck.data.message}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => credentialsCheck.refetch()}
                disabled={credentialsCheck.isFetching}
              >
                {credentialsCheck.isFetching ? "Verificando..." : "Verificar configuração"}
              </Button>
              <Button
                onClick={() =>
                  startEnterprise.mutate({
                    data: { callbackBaseUrl: window.location.origin },
                  })
                }
                disabled={startEnterprise.isPending}
              >
                {startEnterprise.isPending ? "Abrindo cadastro..." : "Configurar Android Enterprise"}
              </Button>
            </div>
          </>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-6 md:col-span-2">
        <h2 className="font-display text-base">Aparelhos cadastrados</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Cada profissional gera o próprio link de ativação na própria tela - não precisa mais
          cadastrar aqui antes. Esta lista é só pra acompanhar/revogar.
        </p>
        <ul className="mt-4 space-y-3">
          {data.devices.length === 0 && (
            <li className="text-sm text-muted-foreground">Nenhum aparelho cadastrado ainda.</li>
          )}
          {data.devices.map((d) => (
            <li key={d.id} className="rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{d.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.model} · situação: {d.enrollment_status}
                  </p>
                  <p className="text-xs text-muted-foreground">id {d.id.slice(0, 8)}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  {d.enrollment_status !== "revogado" && enterpriseStatus.data?.configured && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        generateQr.mutate(
                          { data: { deviceId: d.id } },
                          {
                            onSuccess: (res: { qrCodePngBase64: string }) =>
                              setQrByDevice((prev) => ({ ...prev, [d.id]: res.qrCodePngBase64 })),
                          },
                        )
                      }
                      disabled={generateQr.isPending}
                    >
                      Gerar QR de provisionamento
                    </Button>
                  )}
                  {d.enrollment_status !== "revogado" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => revoke.mutate({ data: { deviceId: d.id } })}
                      disabled={revoke.isPending}
                    >
                      Revogar
                    </Button>
                  )}
                </div>
              </div>
              {qrByDevice[d.id] && (
                <div className="mt-3 flex flex-col items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-4">
                  <img
                    src={`data:image/png;base64,${qrByDevice[d.id]}`}
                    alt={`QR de provisionamento do aparelho ${d.name}`}
                    className="h-48 w-48"
                  />
                  <p className="text-center text-xs text-muted-foreground">
                    No aparelho recém-resetado de fábrica, na tela de boas-vindas, toque 6 vezes em
                    um ponto vazio da tela e escaneie este QR. Válido por 1 hora.
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-border bg-card p-6 md:col-span-2">
        <h2 className="font-display text-base">Auditoria</h2>
        <AuditList items={data.audit} />
      </section>
    </div>
  );
}

function ProfissionalView({ data }: { data: Workspace }) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["workspace"] });

  // RLS já restringe "devices" ao próprio profissional (ou a tudo, se for TI
  // vendo via TiView) — aqui pegamos o aparelho independente do status, para
  // conseguir mostrar o link de instalação enquanto ele ainda está "pendente".
  const primary = data.devices[0];
  const activeSession = data.sessions.find(
    (s) => s.status === "ativa" && s.device_id === primary?.id,
  );
  const installUrl =
    primary?.enrollment_token && typeof window !== "undefined"
      ? `${window.location.origin}/instalar/${primary.enrollment_token}`
      : "";

  const [reason, setReason] = useState(
    "Esqueci o celular em casa e preciso liberar um pagamento.",
  );
  const [mode, setMode] = useState<"visualizacao" | "controle">("controle");
  const [deviceName, setDeviceName] = useState("Meu celular");

  // Autoatendimento (decisão 05/10/2026, ver roadmap.md): a própria pessoa
  // gera o link de ativação do próprio aparelho, sem precisar de TI nem de
  // código de ninguém. Quem gera o link já fica dono - owner_user_id é
  // sempre quem chamou createOwnDevice.
  const createOwn = useMutation({
    mutationFn: useServerFn(createOwnDevice),
    onSuccess: () => {
      toast.success("Link gerado. Abra-o no próprio celular que você quer acessar remotamente.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const acceptSelf = useMutation({
    mutationFn: useServerFn(acceptEnrollment),
    onSuccess: () => {
      toast.success("Aparelho ativado.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const start = useMutation({
    mutationFn: useServerFn(startSession),
    onSuccess: () => {
      toast.success("Sessão iniciada. O aparelho vai pedir consentimento.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const stop = useMutation({
    mutationFn: useServerFn(endSession),
    onSuccess: () => {
      toast.success("Sessão encerrada.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!primary) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground">
          Você ainda não tem um celular vinculado. Gere o link de ativação e abra-o{" "}
          <strong>no próprio celular</strong> que você quer poder acessar remotamente.
        </p>
        <form
          className="mt-6 space-y-3 text-left"
          onSubmit={(e) => {
            e.preventDefault();
            createOwn.mutate({ data: { name: deviceName } });
          }}
        >
          <div className="space-y-1">
            <Label>Nome do aparelho</Label>
            <Input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={createOwn.isPending}>
            {createOwn.isPending ? "Gerando..." : "Gerar link de ativação"}
          </Button>
        </form>
      </div>
    );
  }

  if (primary.enrollment_status === "revogado") {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground">
          A gestão do aparelho <strong>{primary.name}</strong> foi revogada pelo TI. Peça um novo
          cadastro se ainda precisar de acesso remoto.
        </p>
      </div>
    );
  }

  if (primary.enrollment_status === "pendente") {
    return (
      <div className="grid gap-6 md:grid-cols-[360px_1fr]">
        <section className="rounded-2xl border border-border bg-card p-6">
          <h2 className="font-display text-base">{primary.name}</h2>
          <p className="text-sm text-muted-foreground">{primary.model} · aguardando ativação</p>

          <div className="mt-6 rounded-lg border border-primary/40 bg-primary/5 p-4">
            <p className="text-sm text-foreground">
              Para poder acessar este celular remotamente, abra o link abaixo{" "}
              <strong>no navegador do próprio aparelho</strong> — não neste computador — e siga o
              passo a passo.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <input
                readOnly
                value={installUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full truncate rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard?.writeText(installUrl);
                  toast.success("Link copiado.");
                }}
              >
                Copiar
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              O app de gestão que esse link instala ainda está em desenvolvimento. Enquanto isso,
              use o botão abaixo para concluir a ativação manualmente (útil para testar sem
              esperar o instalador real do celular).
            </p>
            <Button
              className="mt-3 w-full"
              variant="outline"
              onClick={() =>
                acceptSelf.mutate({
                  data: { deviceId: primary.id, enrollmentToken: primary.enrollment_token ?? "" },
                })
              }
              disabled={acceptSelf.isPending || !primary.enrollment_token}
            >
              {acceptSelf.isPending ? "Ativando..." : "Concluir ativação manualmente (teste)"}
            </Button>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-6">
          <h2 className="font-display text-base">Histórico de acessos</h2>
          <AuditList items={data.audit.filter((a) => a.device_id === primary.id)} />
        </section>
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-[360px_1fr]">
      <section className="rounded-2xl border border-border bg-card p-6">
        <h2 className="font-display text-base">{primary.name}</h2>
        <p className="text-sm text-muted-foreground">
          {primary.model} · bateria:{" "}
          {primary.battery_level != null ? `${primary.battery_level}%` : "sem dados"}
        </p>
        <p className="text-xs text-muted-foreground">
          Último contato:{" "}
          {primary.last_seen_at
            ? new Date(primary.last_seen_at).toLocaleString("pt-BR")
            : "o app ainda não conectou"}
        </p>

        <PhoneMirror
          deviceId={primary.id}
          deviceName={primary.name}
          activeSession={activeSession}
          reason={reason}
          setReason={setReason}
          mode={mode}
          setMode={setMode}
          onUnlock={() => start.mutate({ data: { deviceId: primary.id, reason, mode } })}
          onEndSession={() =>
            activeSession && stop.mutate({ data: { sessionId: activeSession.id } })
          }
          starting={start.isPending}
          stopping={stop.isPending}
        />
      </section>

      <section className="rounded-2xl border border-border bg-card p-6">
        <h2 className="font-display text-base">Histórico de acessos</h2>
        <AuditList items={data.audit.filter((a) => a.device_id === primary.id)} />
      </section>
    </div>
  );
}

/**
 * Espelho do celular do profissional: reproduz o design que combinamos —
 * banner de consentimento sempre visível durante a sessão, aviso de
 * "aparelho gerenciado pela empresa" e o gesto de arrastar para
 * desbloquear em vez de um botão comum. Sem sessão ativa, mostra a tela
 * de bloqueio; a sessão real só começa quando o arraste chega ao fim.
 *
 * Enquanto há sessão ativa, mostra o último frame que o aparelho mandou
 * (poucos por segundo - ver screen.functions.ts e o roadmap para o porquê
 * de não ser um vídeo WebRTC de verdade) e, em modo "controle", converte
 * toque/arraste sobre a imagem em comandos enviados para o aparelho.
 */
function PhoneMirror({
  deviceId,
  deviceName,
  activeSession,
  reason,
  setReason,
  mode,
  setMode,
  onUnlock,
  onEndSession,
  starting,
  stopping,
}: {
  deviceId: string;
  deviceName: string;
  activeSession: Workspace["sessions"][number] | undefined;
  reason: string;
  setReason: (v: string) => void;
  mode: "visualizacao" | "controle";
  setMode: (v: "visualizacao" | "controle") => void;
  onUnlock: () => void;
  onEndSession: () => void;
  starting: boolean;
  stopping: boolean;
}) {
  const [slide, setSlide] = useState(0);
  const [showForm, setShowForm] = useState(false);

  function handleSlideChange(value: number) {
    setSlide(value);
    if (value >= 96 && !starting) {
      onUnlock();
      // A tela real vira "sessão ativa" assim que a mutação confirmar;
      // isso só reseta a alça visual do gesto.
      setTimeout(() => setSlide(0), 300);
    }
  }

  return (
    <div className="mt-6 overflow-hidden rounded-[28px] border border-border bg-foreground/[0.03]">
      {/* Aviso de consentimento — visível sempre que a sessão está ativa, nunca opcional. */}
      {activeSession && (
        <div className="flex items-center gap-2 bg-primary/10 px-4 py-2 text-xs font-medium text-primary">
          <span className="h-2 w-2 rounded-full bg-primary" />
          Você está acessando o seu próprio celular
        </div>
      )}

      <div className="border-b border-border/60 bg-card/60 px-4 py-2 text-center text-[11px] text-muted-foreground">
        Aparelho gerenciado pela empresa
      </div>

      <div className="flex min-h-[380px] flex-col justify-between p-5">
        {activeSession ? (
          <>
            <div className="flex-1">
              <ScreenView deviceId={deviceId} mode={activeSession.mode as "visualizacao" | "controle"} />
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                {deviceName} · modo {activeSession.mode === "controle" ? "controle" : "visualização"} ·
                iniciada às{" "}
                {new Date(activeSession.started_at).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={onEndSession}
              disabled={stopping}
            >
              {stopping ? "Encerrando..." : "Encerrar sessão"}
            </Button>
          </>
        ) : showForm ? (
          <div className="flex-1 space-y-3">
            <div className="space-y-1">
              <Label>Motivo do acesso</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
            </div>
            <div className="space-y-1">
              <Label>Modo</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["visualizacao", "controle"] as const).map((m) => (
                  <Button
                    key={m}
                    type="button"
                    variant={mode === m ? "default" : "outline"}
                    onClick={() => setMode(m)}
                    className="w-full"
                  >
                    {m === "visualizacao" ? "Ver tela" : "Controlar"}
                  </Button>
                ))}
              </div>
            </div>

            <SlideToUnlock value={slide} onChange={handleSlideChange} disabled={starting} />
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-foreground/5 text-2xl">
              🔒
            </div>
            <p className="text-sm text-muted-foreground">
              Aparelho bloqueado. Informe o motivo do acesso para desbloquear remotamente.
            </p>
            <Button onClick={() => setShowForm(true)}>Iniciar acesso ao meu celular</Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Busca em polling o último frame da tela do aparelho (ver
 * screen.functions.ts) e, em modo "controle", converte toque/arraste feito
 * sobre a imagem em coordenadas normalizadas (0 a 1) enviadas via
 * sendDeviceInput. 800ms de intervalo é um meio-termo - mais rápido que
 * isso só aumenta custo de Storage sem ganho visível, dado que o aparelho
 * também só captura poucos frames por segundo do lado dele.
 */
function ScreenView({ deviceId, mode }: { deviceId: string; mode: "visualizacao" | "controle" }) {
  const fetchFrameUrl = useServerFn(getDeviceFrameUrl);
  const frame = useQuery({
    queryKey: ["device-frame", deviceId],
    queryFn: () => fetchFrameUrl({ data: { deviceId } }),
    refetchInterval: 800,
    refetchIntervalInBackground: true,
  });

  const sendInput = useMutation({
    mutationFn: useServerFn(sendDeviceInput),
    onError: (e: Error) => toast.error(e.message),
  });

  const pointerStart = useRef<{ x: number; y: number; t: number } | null>(null);

  function fractionFromEvent(e: ReactPointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    return { x, y };
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (mode !== "controle") return;
    const { x, y } = fractionFromEvent(e);
    pointerStart.current = { x, y, t: Date.now() };
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (mode !== "controle" || !pointerStart.current) return;
    const start = pointerStart.current;
    pointerStart.current = null;
    const end = fractionFromEvent(e);
    const durationMs = Date.now() - start.t;
    const distance = Math.hypot(end.x - start.x, end.y - start.y);

    if (distance < 0.02) {
      sendInput.mutate({ data: { deviceId, kind: "tap", x: start.x, y: start.y } });
    } else {
      sendInput.mutate({
        data: {
          deviceId,
          kind: "swipe",
          x: start.x,
          y: start.y,
          x2: end.x,
          y2: end.y,
          durationMs: Math.min(5000, Math.max(50, durationMs)),
        },
      });
    }
  }

  return (
    <div
      className="relative mx-auto aspect-[9/16] w-full max-w-[220px] overflow-hidden rounded-2xl bg-black/90 select-none"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      style={{ touchAction: mode === "controle" ? "none" : undefined, cursor: mode === "controle" ? "crosshair" : "default" }}
    >
      {frame.data?.found && frame.data.url ? (
        <img
          src={frame.data.url}
          alt={`Tela do aparelho`}
          className="pointer-events-none h-full w-full object-contain"
          draggable={false}
        />
      ) : (
        <div className="flex h-full items-center justify-center p-4 text-center text-[11px] text-white/60">
          Aguardando o aparelho começar a enviar a tela... (ele precisa estar com a permissão de
          captura de tela concedida)
        </div>
      )}
    </div>
  );
}

/** Gesto de arrastar para desbloquear — substitui o botão comum de início de sessão. */
function SlideToUnlock({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="relative mt-2 h-12 w-full overflow-hidden rounded-full border border-border bg-foreground/5">
      <div
        className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-primary/20 transition-[width]"
        style={{ width: `${value}%` }}
      />
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-medium text-muted-foreground">
        {disabled ? "Desbloqueando..." : "Arraste para desbloquear e iniciar o acesso"}
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        aria-label="Arraste para desbloquear e iniciar o acesso ao celular"
      />
    </div>
  );
}

function AuditList({ items }: { items: Workspace["audit"] }) {
  if (items.length === 0) {
    return <p className="mt-4 text-sm text-muted-foreground">Sem eventos ainda.</p>;
  }
  return (
    <ul className="mt-4 space-y-2">
      {items.map((e) => (
        <li key={e.id} className="rounded-lg border border-border px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{labelEvent(e.event_type)}</span>
            <span className="text-xs text-muted-foreground">
              {new Date(e.created_at).toLocaleString("pt-BR")}
            </span>
          </div>
          {e.details && (
            <p className="mt-1 text-xs text-muted-foreground">
              {Object.entries(e.details as Record<string, unknown>)
                .map(([k, v]) => `${k}: ${String(v)}`)
                .join(" · ")}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function labelEvent(type: string) {
  const map: Record<string, string> = {
    conta_criada: "Conta criada",
    enrollment_iniciado: "Cadastro iniciado",
    enrollment_concluido: "Aparelho ativado",
    gestao_revogada: "Gestão revogada",
    sessao_iniciada: "Sessão de acesso iniciada",
    sessao_encerrada: "Sessão encerrada",
  };
  return map[type] ?? type;
}
