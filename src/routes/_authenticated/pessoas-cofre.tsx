import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/lib/backend/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pessoas-cofre")({
  head: () => ({
    meta: [{ title: "Pessoas e aparelhos — Cofre" }],
  }),
  component: PessoasCofrePage,
});

type Aparelho = {
  id: string;
  pessoa_id: string;
  apelido: string;
  plataforma: "android" | "ios" | "outro";
  identificador: string | null;
  ativo: boolean;
};

type Pessoa = {
  id: string;
  nome: string;
  codigo: string | null;
  cofre_conta: string | null;
  ativo: boolean;
  aparelhos: Aparelho[];
};

// A migration pessoas_aparelhos pode ainda não ter sido aplicada no banco.
// Nesse caso o Postgres responde com este código (relação inexistente).
const TABELA_FALTANDO = "42P01";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

function usePessoas() {
  return useQuery<{ pessoas: Pessoa[]; migracaoFaltando: boolean }>({
    queryKey: ["pessoas-cofre"],
    queryFn: async () => {
      const { data, error } = await db
        .from("pessoas")
        .select("*, aparelhos(*)")
        .order("criado_em", { ascending: true });
      if (error) {
        if (error.code === TABELA_FALTANDO) {
          return { pessoas: [], migracaoFaltando: true };
        }
        throw error;
      }
      return { pessoas: (data ?? []) as Pessoa[], migracaoFaltando: false };
    },
  });
}

function PessoasCofrePage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = usePessoas();
  const invalidar = () => qc.invalidateQueries({ queryKey: ["pessoas-cofre"] });

  const [nome, setNome] = useState("");
  const [codigo, setCodigo] = useState("");

  const addPessoa = useMutation({
    mutationFn: async () => {
      const { error } = await db.from("pessoas").insert({
        nome: nome.trim(),
        codigo: codigo.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Funcionário cadastrado.");
      setNome("");
      setCodigo("");
      invalidar();
    },
    onError: (e: unknown) =>
      toast.error("Não salvou: " + (e instanceof Error ? e.message : "erro")),
  });

  const removerPessoa = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("pessoas").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removido.");
      invalidar();
    },
    onError: (e: unknown) =>
      toast.error("Não removeu: " + (e instanceof Error ? e.message : "erro")),
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="font-display text-lg">
              Pessoas e <span className="text-primary">aparelhos</span>
            </h1>
            <p className="text-xs text-muted-foreground">
              1 funcionário, vários aparelhos · a conta do cofre é por pessoa
            </p>
          </div>
          <Link to="/cofre">
            <Button variant="outline" size="sm">
              ← Voltar
            </Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8">
        {/* Novo funcionário */}
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-display text-base">Cadastrar funcionário</h2>
          <form
            className="mt-3 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!nome.trim()) {
                toast.error("Informe o nome.");
                return;
              }
              addPessoa.mutate();
            }}
          >
            <div className="flex min-w-[180px] flex-1 flex-col gap-1">
              <Label htmlFor="nome">Nome</Label>
              <Input
                id="nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex: Maria Silva"
              />
            </div>
            <div className="flex w-36 flex-col gap-1">
              <Label htmlFor="codigo">Código</Label>
              <Input
                id="codigo"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                placeholder="matrícula"
              />
            </div>
            <Button type="submit" disabled={addPessoa.isPending}>
              {addPessoa.isPending ? "Salvando…" : "Adicionar"}
            </Button>
          </form>
        </section>

        {/* Avisos de estado */}
        {isLoading && (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        )}
        {data?.migracaoFaltando && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300">
            As tabelas <code>pessoas</code> e <code>aparelhos</code> ainda não foram
            criadas no banco. Aplique a migration{" "}
            <code>20261126120000_pessoas_aparelhos.sql</code> para ativar esta tela.
          </p>
        )}
        {error && !data?.migracaoFaltando && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            Erro ao carregar: {error instanceof Error ? error.message : "desconhecido"}
          </p>
        )}

        {/* Lista */}
        <section className="flex flex-col gap-3">
          {data?.pessoas.map((p) => (
            <PessoaCard
              key={p.id}
              pessoa={p}
              onRemover={() => removerPessoa.mutate(p.id)}
              onMudou={invalidar}
            />
          ))}
          {data && !data.migracaoFaltando && data.pessoas.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum funcionário ainda. Cadastre o primeiro acima.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}

function PessoaCard({
  pessoa,
  onRemover,
  onMudou,
}: {
  pessoa: Pessoa;
  onRemover: () => void;
  onMudou: () => void;
}) {
  const [apelido, setApelido] = useState("");
  const [plataforma, setPlataforma] = useState<Aparelho["plataforma"]>("android");

  const addAparelho = useMutation({
    mutationFn: async () => {
      const { error } = await db.from("aparelhos").insert({
        pessoa_id: pessoa.id,
        apelido: apelido.trim(),
        plataforma,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Aparelho adicionado.");
      setApelido("");
      onMudou();
    },
    onError: (e: unknown) =>
      toast.error("Não salvou: " + (e instanceof Error ? e.message : "erro")),
  });

  const removerAparelho = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("aparelhos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: onMudou,
  });

  const emoji: Record<Aparelho["plataforma"], string> = {
    android: "🤖",
    ios: "🍎",
    outro: "📱",
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-sm">{pessoa.nome}</h3>
          <p className="text-xs text-muted-foreground">
            {pessoa.codigo ? `código ${pessoa.codigo} · ` : ""}
            {pessoa.cofre_conta ? `cofre: ${pessoa.cofre_conta}` : "sem conta no cofre ainda"}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onRemover}>
          Remover
        </Button>
      </div>

      {/* Aparelhos */}
      <div className="mt-3 flex flex-col gap-1">
        {pessoa.aparelhos?.length ? (
          pessoa.aparelhos.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm"
            >
              <span>
                {emoji[a.plataforma]} {a.apelido}
                <span className="ml-2 text-xs text-muted-foreground">
                  {a.plataforma}
                </span>
              </span>
              <button
                className="text-xs text-muted-foreground hover:text-destructive"
                onClick={() => removerAparelho.mutate(a.id)}
              >
                remover
              </button>
            </div>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">Nenhum aparelho.</p>
        )}
      </div>

      {/* Adicionar aparelho */}
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!apelido.trim()) {
            toast.error("Dê um apelido ao aparelho.");
            return;
          }
          addAparelho.mutate();
        }}
      >
        <Input
          value={apelido}
          onChange={(e) => setApelido(e.target.value)}
          placeholder="Apelido (ex: iPhone do trabalho)"
          className="min-w-[160px] flex-1"
        />
        <select
          value={plataforma}
          onChange={(e) => setPlataforma(e.target.value as Aparelho["plataforma"])}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="android">Android</option>
          <option value="ios">iPhone</option>
          <option value="outro">Outro</option>
        </select>
        <Button type="submit" variant="outline" size="sm" disabled={addAparelho.isPending}>
          + Aparelho
        </Button>
      </form>
    </div>
  );
}
