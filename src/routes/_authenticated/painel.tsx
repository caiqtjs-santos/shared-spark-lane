import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  getWorkspace,
  registerDevice,
  acceptEnrollment,
  revokeDevice,
} from "@/lib/mdm.functions";
import {
  getEnterpriseStatus,
  startEnterpriseSignup,
  createDeviceQrProvisioning,
  checkAndroidCredentials,
} from "@/lib/enterprise.functions";
import { issueDeviceCommand } from "@/lib/device-commands.functions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/lib/backend/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  queryOptions({
    queryKey: ["workspace"],
    queryFn: () => fn(),
    // O aparelho é ativado no celular, não nesta tela: sem isto, o status só
    // mudaria de "pendente" para "ativo" depois de recarregar a página.
    refetchInterval: 10_000,
  });

function PainelPage() {
  const navigate = useNavigate();
  const load = useServerFn(getWorkspace);
  const { data, isLoading, error, refetch, isFetching } = useQuery(workspaceQuery(load));

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  // Sem isto, qualquer falha do servidor ao carregar os dados deixava a tela
  // presa em "Carregando painel..." para sempre, sem dizer o motivo.
  if (error && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md rounded-2xl border border-border bg-card p-8 text-center">
          <p className="font-display text-base text-card-foreground">
            Não foi possível carregar o painel
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            O servidor respondeu com um erro. Tente de novo; se continuar, saia e entre outra vez.
          </p>
          <p className="mt-3 break-words rounded-md bg-muted/50 px-3 py-2 text-left font-mono text-xs text-muted-foreground">
            {(error as Error).message || "Erro sem descrição."}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? "Tentando..." : "Tentar de novo"}
            </Button>
            <Button variant="outline" onClick={handleSignOut}>
              Sair
            </Button>
          </div>
        </div>
      </div>
    );
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
              {data.role === "ti" ? "Time de TI" : "Sem acesso ao painel"}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleSignOut}>
            Sair
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {data.role === "ti" ? (
          <TiView data={data} />
        ) : (
          <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-8 text-center">
            <p className="text-muted-foreground">
              O painel é só para o time de TI. Profissionais acessam o próprio aparelho pelo link
              que o TI enviou.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

type Workspace = Awaited<ReturnType<typeof getWorkspace>>;

function TiView({ data }: { data: Workspace }) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["workspace"] });

  const [qrByDevice, setQrByDevice] = useState<Record<string, string>>({});

  // Cadastro de aparelho pelo TI (decisão de 05/10/2026, ver roadmap.md): o
  // TI gera o link, abre no celular, dá o aceite e instala o app ANTES de
  // entregar o aparelho; o profissional recebe o aparelho pronto e o login.
  const [professionalName, setProfessionalName] = useState("");
  const [newDeviceName, setNewDeviceName] = useState("Celular corporativo");
  const [lastRegistered, setLastRegistered] = useState<{
    deviceName: string;
    professionalName: string;
    enrollmentToken: string;
  } | null>(null);

  const installLink = (token: string) =>
    typeof window !== "undefined" ? `${window.location.origin}/instalar/${token}` : "";
  const copy = (text: string, done: string) => {
    navigator.clipboard?.writeText(text);
    toast.success(done);
  };

  const register = useMutation({
    mutationFn: useServerFn(registerDevice),
    onSuccess: (res: { deviceName: string; professionalName: string; enrollmentToken: string }) => {
      setLastRegistered({
        deviceName: res.deviceName,
        professionalName: res.professionalName,
        enrollmentToken: res.enrollmentToken,
      });
      setProfessionalName("");
      toast.success("Aparelho cadastrado. Abra o link no celular para ativar.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const activateWithoutApp = useMutation({
    mutationFn: useServerFn(acceptEnrollment),
    onSuccess: () => {
      toast.success("Aparelho marcado como ativo (sem o app).");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

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
        <h2 className="font-display text-base">Cadastrar aparelho</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Você gera um único link: abre no celular que vai ser acessado, dá o aceite e instala o
          app. O mesmo link serve ao profissional para acessar o aparelho depois, sem login.
        </p>

        <form
          className="mt-4 grid gap-4 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (professionalName.trim().length < 2) {
              toast.error("Informe o nome do profissional.");
              return;
            }
            register.mutate({
              data: {
                deviceName: newDeviceName.trim() || "Celular corporativo",
                professionalName: professionalName.trim(),
              },
            });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="professional-name">Nome do profissional</Label>
            <Input
              id="professional-name"
              value={professionalName}
              onChange={(e) => setProfessionalName(e.target.value)}
              placeholder="João Pereira"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="new-device-name">Nome do aparelho</Label>
            <Input
              id="new-device-name"
              value={newDeviceName}
              onChange={(e) => setNewDeviceName(e.target.value)}
            />
          </div>

          <div className="md:col-span-2">
            <Button type="submit" disabled={register.isPending}>
              {register.isPending ? "Cadastrando..." : "Cadastrar e gerar link"}
            </Button>
          </div>
        </form>

        {lastRegistered && (
          <div className="mt-5 rounded-lg border border-primary/40 bg-primary/5 p-4">
            <p className="text-sm font-medium text-foreground">
              Link de {lastRegistered.professionalName} · {lastRegistered.deviceName}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Abra no celular para dar o aceite e instalar o app. Depois, é o mesmo link que o
              profissional usa para acessar o aparelho remotamente — sem login.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                readOnly
                value={installLink(lastRegistered.enrollmentToken)}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full truncate rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => copy(installLink(lastRegistered.enrollmentToken), "Link copiado.")}
              >
                Copiar
              </Button>
            </div>
          </div>
        )}
      </section>

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
              Enquanto isso não estiver configurado, o app é instalado pelo link de ativação
              gerado em "Cadastrar aparelho".
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
          Todos os aparelhos cadastrados, com o profissional de cada um. O link do aparelho pode ser
          copiado de novo aqui.
        </p>
        <ul className="mt-4 space-y-3">
          {data.devices.length === 0 && (
            <li className="text-sm text-muted-foreground">Nenhum aparelho cadastrado ainda.</li>
          )}
          {data.devices.map((d) => (
            <li key={d.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-medium">{d.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.model} · situação: {d.enrollment_status}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {d.professional_name ?? "sem profissional informado"}{" "}
                    · id {d.id.slice(0, 8)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                  {d.enrollment_status === "pendente" && d.enrollment_token && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copy(installLink(d.enrollment_token ?? ""), "Link copiado.")}
                      >
                        Copiar link de ativação
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          activateWithoutApp.mutate({
                            data: { deviceId: d.id, enrollmentToken: d.enrollment_token ?? "" },
                          })
                        }
                        disabled={activateWithoutApp.isPending}
                      >
                        Ativar sem o app (apenas teste)
                      </Button>
                    </>
                  )}
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
                  {d.enrollment_status === "ativo" &&
                    (d.device_owner ? (
                      <DeviceCommandButtons deviceId={d.id} deviceName={d.name} />
                    ) : (
                      <p className="max-w-56 text-right text-xs text-muted-foreground">
                        Sem bloquear/reiniciar/apagar remotos neste aparelho (já tinha conta
                        configurada ao ativar). Ver/controlar tela continuam disponíveis.
                      </p>
                    ))}
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
    aceite_registrado: "Aceite registrado no celular",
    enrollment_concluido: "Aparelho ativado",
    gestao_revogada: "Gestão revogada",
    sessao_iniciada: "Sessão de acesso iniciada",
    sessao_encerrada: "Sessão encerrada",
    comando_enviado: "Comando enviado ao aparelho",
    comando_entregue: "Comando recebido pelo aparelho",
  };
  return map[type] ?? type;
}

/**
 * Comandos remotos do TI (ver device-commands.functions.ts). O aparelho busca
 * o comando em até ~15s (polling) e o executa localmente como Device Owner.
 * "Apagar" é irreversível, por isso só segue depois do diálogo de confirmação.
 */
function DeviceCommandButtons({ deviceId, deviceName }: { deviceId: string; deviceName: string }) {
  const qc = useQueryClient();
  const issue = useServerFn(issueDeviceCommand);
  const send = useMutation({
    mutationFn: (vars: { deviceId: string; kind: "lock" | "reboot" | "wipe"; confirmWipe?: boolean }) =>
      issue({ data: vars }),
    onSuccess: (_res, { kind }) => {
      toast.success(
        kind === "lock"
          ? "Comando enviado: o aparelho vai bloquear a tela em instantes."
          : kind === "reboot"
            ? "Comando enviado: o aparelho vai reiniciar em instantes."
            : "Comando enviado: o aparelho vai ser apagado em instantes.",
      );
      qc.invalidateQueries({ queryKey: ["workspace"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex flex-wrap gap-2 sm:justify-end">
      <Button
        variant="outline"
        size="sm"
        disabled={send.isPending}
        onClick={() => send.mutate({ deviceId, kind: "lock" })}
      >
        Bloquear tela
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={send.isPending}
        onClick={() => send.mutate({ deviceId, kind: "reboot" })}
      >
        Reiniciar
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" size="sm" disabled={send.isPending}>
            Apagar aparelho
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar o aparelho "{deviceName}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso apaga TODOS os dados do celular e o devolve ao estado de fábrica. Não tem
              volta: fotos, apps e arquivos que não estiverem em outro lugar serão perdidos, e
              o aparelho precisará ser cadastrado de novo. O comando é executado assim que o
              aparelho estiver ligado e com internet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => send.mutate({ deviceId, kind: "wipe", confirmWipe: true })}
            >
              Sim, apagar tudo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
