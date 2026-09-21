import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";

/**
 * Página pública que o token de ativação aponta para. Precisa ser aberta
 * NO PRÓPRIO CELULAR que vai ser acessado remotamente — é isso que a
 * torna diferente de um link clicado em qualquer lugar: o app de gestão
 * só existe (ou vai existir) no aparelho onde essa página for aberta.
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
                <li>1. Toque em "Baixar e ativar" abaixo.</li>
                <li>2. Um único aceite instala o app e liga o aviso permanente na tela.</li>
                <li>3. A partir daí, o acesso remoto a este aparelho fica disponível no painel.</li>
              </ol>

              <Button className="mt-6 w-full" disabled title="Instalador ainda não disponível">
                Baixar e ativar
              </Button>
              <p className="mt-3 text-center text-xs text-muted-foreground">
                O aplicativo Android que instala e mantém o aviso de "aparelho gerenciado" ainda
                está em desenvolvimento — este link e esta página já são reais, mas o arquivo
                instalável ainda não existe. Enquanto isso, o TI pode concluir a ativação
                manualmente pelo painel, para testes.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
