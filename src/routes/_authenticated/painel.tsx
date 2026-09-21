import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  getWorkspace,
  createDevice,
  acceptEnrollment,
  revokeDevice,
  startSession,
  endSession,
} from "@/lib/mdm.functions";
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

  const [name, setName] = useState("Celular corporativo");
  const [model, setModel] = useState("Moto G54");
  const [ownerLoginCode, setOwnerLoginCode] = useState("");
  const [pendingToken, setPendingToken] = useState<{ id: string; token: string } | null>(null);

  const create = useMutation({
    mutationFn: useServerFn(createDevice),
    onSuccess: (res: { deviceId: string; enrollmentToken: string }) => {
      setPendingToken({ id: res.deviceId, token: res.enrollmentToken });
      toast.success("Aparelho cadastrado. Envie o código de ativação para o profissional.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const accept = useMutation({
    mutationFn: useServerFn(acceptEnrollment),
    onSuccess: () => {
      toast.success("Aparelho ativado.");
      setPendingToken(null);
      invalidate();
    },
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
      <section className="rounded-2xl border border-border bg-card p-6">
        <h2 className="font-display text-base">Cadastrar aparelho</h2>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ data: { name, model, ownerLoginCode } });
          }}
        >
          <div className="space-y-1">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Modelo</Label>
            <Input value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Código do profissional dono</Label>
            <Input
              value={ownerLoginCode}
              onChange={(e) => setOwnerLoginCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              className="font-mono tracking-widest"
            />
          </div>
          <Button type="submit" disabled={create.isPending} className="w-full">
            {create.isPending ? "Cadastrando..." : "Baixar e ativar app de gestão"}
          </Button>
        </form>

        {pendingToken && (
          <div className="mt-6 rounded-lg border border-primary/40 bg-primary/5 p-4">
            <p className="text-sm text-foreground">
              Um único aceite conclui tudo. Confirme o consentimento no aparelho.
            </p>
            <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
              Token: {pendingToken.token}
            </p>
            <Button
              className="mt-3 w-full"
              onClick={() =>
                accept.mutate({
                  data: { deviceId: pendingToken.id, enrollmentToken: pendingToken.token },
                })
              }
              disabled={accept.isPending}
            >
              {accept.isPending ? "Ativando..." : "Aceitar termos e concluir"}
            </Button>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-6">
        <h2 className="font-display text-base">Aparelhos cadastrados</h2>
        <ul className="mt-4 space-y-3">
          {data.devices.length === 0 && (
            <li className="text-sm text-muted-foreground">Nenhum aparelho cadastrado ainda.</li>
          )}
          {data.devices.map((d) => (
            <li
              key={d.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border p-3"
            >
              <div>
                <p className="font-medium">{d.name}</p>
                <p className="text-xs text-muted-foreground">
                  {d.model} · situação: {d.enrollment_status}
                </p>
                <p className="text-xs text-muted-foreground">id {d.id.slice(0, 8)}</p>
              </div>
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

  const myDevices = data.devices.filter((d) => d.enrollment_status === "ativo");
  const primary = myDevices[0];
  const activeSession = data.sessions.find(
    (s) => s.status === "ativa" && s.device_id === primary?.id,
  );

  const [reason, setReason] = useState(
    "Esqueci o celular em casa e preciso liberar um pagamento.",
  );
  const [mode, setMode] = useState<"visualizacao" | "controle">("controle");

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
      <div className="rounded-2xl border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground">
          Nenhum aparelho ativo vinculado à sua conta. Peça ao TI para cadastrar um usando seu
          código {data.profile?.login_code}.
        </p>
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
 */
function PhoneMirror({
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
        <div className="flex items-center gap-2 bg-emerald-500/10 px-4 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
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
              <div className="grid grid-cols-3 gap-3 pt-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex aspect-square items-center justify-center rounded-2xl bg-foreground/5 text-[10px] text-muted-foreground"
                  >
                    app
                  </div>
                ))}
              </div>
              <p className="mt-4 text-center text-[11px] text-muted-foreground">
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
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                      mode === m
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    {m === "visualizacao" ? "Ver tela" : "Controlar"}
                  </button>
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
