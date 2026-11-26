import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/cofre")({
  head: () => ({
    meta: [
      { title: "Cofre de Senhas — Meu Celular" },
      {
        name: "description",
        content:
          "Acesso do staff às senhas de qualquer aparelho, sem ficarem presas num celular. Stack self-hosted (Vaultwarden) em dois servidores.",
      },
    ],
  }),
  component: CofrePage,
});

type Fase = {
  nome: string;
  status: "pronto" | "aguardando" | "opcional";
  entrega: string;
  falta: string;
  verVer: string;
};

const FASES: Fase[] = [
  {
    nome: "Fase 0 — Infraestrutura",
    status: "aguardando",
    entrega: "Os dois servidores no ar, blindados, ligados pelo túnel. HTTPS ativo.",
    falta: "Scripts prontos. Só falta contratar as 2 VPS e o domínio.",
    verVer:
      "Abrir https://cofre.seudominio.com no navegador e aparecer o cadeado de HTTPS válido.",
  },
  {
    nome: "Fase 1 — Cofre de senhas",
    status: "aguardando",
    entrega:
      "Vaultwarden no ar. Contas do staff criadas, 2FA ligado, cadastros fechados.",
    falta: "Depende da Fase 0. Depois: subir, configurar, criar contas.",
    verVer:
      "Instalar o Bitwarden no celular, apontar pro nosso servidor e as senhas aparecem.",
  },
  {
    nome: "Fase 2 — Acesso remoto Android",
    status: "opcional",
    entrega:
      "MeshCentral + RustDesk nos Androids da empresa. iPhone não — trava da Apple.",
    falta: "Só depois de ver se a Fase 1 já bastou.",
    verVer: "O painel lista o aparelho como online e você vê a tela ao vivo.",
  },
  {
    nome: "Fase 3 — MDM com consentimento",
    status: "opcional",
    entrega:
      "Headwind MDM: apps, bloqueio e localização dos aparelhos, com aceite registrado.",
    falta: "Decisão futura; só se precisar gerir muitos aparelhos.",
    verVer: "O aparelho enrolado aparece no painel do MDM com o aceite na auditoria.",
  },
];

const BADGE: Record<Fase["status"], string> = {
  pronto: "bg-primary/15 text-primary",
  aguardando: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  opcional: "bg-muted text-muted-foreground",
};

const BADGE_TXT: Record<Fase["status"], string> = {
  pronto: "Pronto",
  aguardando: "Aguardando VPS",
  opcional: "Opcional",
};

function CofrePage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="font-display text-lg">
              Cofre de <span className="text-primary">Senhas</span>
            </h1>
            <p className="text-xs text-muted-foreground">
              Funcionalidade nova · a senha deixa de ficar presa num celular
            </p>
          </div>
          <Link to="/painel">
            <Button variant="outline" size="sm">
              ← Voltar ao painel
            </Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8">
        {/* Resumo */}
        <section className="rounded-xl border border-border bg-card p-5">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Quem esquece o celular não trava mais: pega a senha de qualquer
            aparelho, <strong className="text-foreground">Android ou iPhone</strong>.
            Stack 100% nossa, open-source, em dois servidores de países diferentes.
            O desenho, os scripts e as chaves já estão prontos — falta só contratar
            os servidores.
          </p>
        </section>

        {/* Arquitetura */}
        <section className="grid gap-3 md:grid-cols-[1fr_auto_1fr]">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-lg">🇧🇷</div>
            <h3 className="font-display text-sm">Borda — São Paulo</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Entrada rápida do staff. IP público, HTTPS, filtra ataques. Não
              guarda senha.
            </p>
          </div>
          <div className="flex items-center justify-center text-xs text-muted-foreground">
            ══ túnel ══▶
            <br />
            WireGuard
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-lg">🇩🇪</div>
            <h3 className="font-display text-sm">Cofre — Alemanha</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Guarda os dados. Sem porta pública — invisível pra internet, só
              responde pela borda.
            </p>
          </div>
        </section>

        {/* Fases */}
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-base">As fases</h2>
          {FASES.map((f) => (
            <div key={f.nome} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-sm">{f.nome}</h3>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${BADGE[f.status]}`}
                >
                  {BADGE_TXT[f.status]}
                </span>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-muted/50 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    O que entrega
                  </div>
                  <p className="mt-1 text-sm">{f.entrega}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    O que falta
                  </div>
                  <p className="mt-1 text-sm">{f.falta}</p>
                </div>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                👁 <strong className="text-foreground">Você vê acontecendo:</strong>{" "}
                {f.verVer}
              </p>
            </div>
          ))}
        </section>

        {/* Próximo passo */}
        <section className="rounded-xl border border-primary/40 bg-primary/5 p-5">
          <h2 className="font-display text-base text-primary">O próximo passo</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Só falta contratar as duas VPS (Borda no Brasil e Cofre na Alemanha) e
            registrar um domínio. Os scripts de provisionamento (blindagem,
            WireGuard, firewall, Docker) e o runbook estão na pasta{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">cofre/</code> do
            projeto.
          </p>
        </section>

        {/* Limite */}
        <section className="border-l-2 border-destructive pl-4 text-sm text-muted-foreground">
          Nada de controle oculto de celular, furar o Play Protect ou tirar o login
          de quem é monitorado. Isso é padrão de stalkerware e fica fora do escopo. O
          que construímos é cofre + acesso com a pessoa sabendo.
        </section>
      </main>
    </div>
  );
}
