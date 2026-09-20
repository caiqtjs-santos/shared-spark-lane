import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Meu Celular — MDM de acesso remoto autoatendido" },
      {
        name: "description",
        content:
          "Gestão e acesso remoto de celulares corporativos Android. O profissional acessa o próprio aparelho, com consentimento visível e auditoria completa.",
      },
      { property: "og:title", content: "Meu Celular — MDM de acesso remoto autoatendido" },
      {
        property: "og:description",
        content:
          "Painel de gestão de celulares corporativos com acesso remoto autoatendido e auditoria.",
      },
    ],
  }),
  component: Home,
});

function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-6">
        <span className="font-display text-lg">
          Meu<span className="text-primary">Celular</span>
        </span>
        <Link
          to="/auth"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Entrar no painel
        </Link>
      </header>

      <section className="mx-auto max-w-3xl px-4 py-20 text-center">
        <p className="text-sm font-medium uppercase tracking-widest text-primary">
          MDM corporativo
        </p>
        <h1 className="mt-4 font-display text-4xl leading-tight sm:text-5xl">
          O profissional acessa o próprio celular corporativo — com consentimento e auditoria.
        </h1>
        <p className="mt-6 text-lg text-muted-foreground">
          Cadastro em um único aceite, acesso remoto sob demanda e registro imutável de cada
          evento. Sem instalação oculta, sem surpresas.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            to="/auth"
            className="rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Acessar painel
          </Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-4 px-4 pb-20 sm:grid-cols-3">
        {[
          {
            t: "Cadastro em um aceite",
            d: "O TI cadastra o aparelho e o profissional confirma no celular. Fim.",
          },
          {
            t: "Acesso sob demanda",
            d: "O profissional inicia a sessão com motivo e escolhe ver ou controlar.",
          },
          {
            t: "Auditoria imutável",
            d: "Cada cadastro, sessão e revogação fica registrado, com data e responsável.",
          },
        ].map((f) => (
          <div key={f.t} className="rounded-2xl border border-border bg-card p-6">
            <h3 className="font-display text-base">{f.t}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{f.d}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
