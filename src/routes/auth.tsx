import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { createTiAccount } from "@/lib/mdm.functions";
import { codeToEmail, isSixDigits, normalizeCode } from "@/lib/login-code";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — Meu Celular" },
      {
        name: "description",
        content:
          "Entre no painel Meu Celular com seu código de 6 dígitos e sua senha de 6 dígitos.",
      },
      { property: "og:title", content: "Entrar — Meu Celular" },
      {
        property: "og:description",
        content: "Acesso ao painel de gestão e acesso remoto de celulares corporativos.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const createAccount = useServerFn(createTiAccount);
  const [mode, setMode] = useState<"entrar" | "criar">("entrar");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isSixDigits(code) || !isSixDigits(password)) {
      toast.error("O código e a senha precisam ter exatamente 6 dígitos.");
      return;
    }
    setLoading(true);
    try {
      if (mode === "entrar") {
        const { error } = await supabase.auth.signInWithPassword({
          email: codeToEmail(code),
          password,
        });
        if (error) throw new Error("Código ou senha incorretos.");
        navigate({ to: "/painel" });
        return;
      }

      if (name.trim().length < 2) {
        toast.error("Informe seu nome completo.");
        return;
      }
      // A conta é criada pelo servidor (já confirmada) e só depois entramos
      // com ela - ver createTiAccount para o porquê de não usar o cadastro
      // comum pelo navegador.
      await createAccount({ data: { loginCode: code, password, name: name.trim() } });
      const signIn = await supabase.auth.signInWithPassword({
        email: codeToEmail(code),
        password,
      });
      if (signIn.error) throw new Error("Conta criada, mas o acesso falhou. Tente entrar.");
      toast.success("Conta criada. Bem-vindo!");
      navigate({ to: "/painel" });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 block text-center font-display text-2xl text-foreground">
          Meu<span className="text-primary">Celular</span>
        </Link>

        <div className="rounded-2xl border border-border bg-card p-8 shadow-lg">
          <h1 className="font-display text-xl text-card-foreground">
            {mode === "entrar" ? "Acessar o painel" : "Criar acesso do time de TI"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "entrar"
              ? "Use seu código de 6 dígitos e sua senha de 6 dígitos."
              : "Escolha um código e uma senha de 6 dígitos. Profissionais não se cadastram aqui: o login deles é criado pelo TI e entregue junto com o aparelho."}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {mode === "criar" && (
              <div className="space-y-2">
                <Label htmlFor="name">Seu nome</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="João Pereira"
                  autoComplete="name"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="code">Código de acesso (6 dígitos)</Label>
              <Input
                id="code"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(normalizeCode(e.target.value))}
                placeholder="000000"
                className="text-center font-mono text-lg tracking-[0.5em]"
                autoComplete="username"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Senha (6 dígitos)</Label>
              <Input
                id="password"
                type="password"
                inputMode="numeric"
                value={password}
                onChange={(e) => setPassword(normalizeCode(e.target.value))}
                placeholder="••••••"
                className="text-center font-mono text-lg tracking-[0.5em]"
                autoComplete={mode === "entrar" ? "current-password" : "new-password"}
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading
                ? "Aguarde..."
                : mode === "entrar"
                  ? "Entrar"
                  : "Criar acesso e entrar"}
            </Button>
          </form>

          <button
            type="button"
            onClick={() => setMode(mode === "entrar" ? "criar" : "entrar")}
            className="mt-6 w-full text-sm text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
          >
            {mode === "entrar"
              ? "Sou do time de TI e ainda não tenho acesso — criar agora"
              : "Já tenho um código — entrar"}
          </button>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          O acesso ao aparelho é sempre com consentimento visível e fica registrado na auditoria.
        </p>
      </div>
    </main>
  );
}
