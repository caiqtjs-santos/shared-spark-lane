import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { completeEnterpriseSignupFn } from "@/lib/enterprise.functions";

/**
 * Para onde o Google redireciona o navegador do TI depois que ele conclui
 * a criação da enterprise (Managed Google Play) na tela hospedada do
 * próprio Google. Vem com `?state=...&enterpriseToken=...` na URL - ver
 * startEnterpriseSignup / completeEnterpriseSignupFn em
 * src/lib/enterprise.functions.ts para o porquê do `state`.
 */
export const Route = createFileRoute("/_authenticated/ti/enterprise-callback")({
  ssr: false,
  component: EnterpriseCallbackPage,
});

function EnterpriseCallbackPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"processando" | "erro" | "ok">("processando");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const state = params.get("state");
    const enterpriseToken = params.get("enterpriseToken");

    if (!state || !enterpriseToken) {
      setStatus("erro");
      setErrorMessage("Faltam parâmetros na URL de retorno do Google (state/enterpriseToken).");
      return;
    }

    completeEnterpriseSignupFn({ data: { state, enterpriseToken } })
      .then(() => {
        setStatus("ok");
        setTimeout(() => navigate({ to: "/painel" }), 1500);
      })
      .catch((e: Error) => {
        setStatus("erro");
        setErrorMessage(e.message);
      });
  }, [navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-lg">
        {status === "processando" && (
          <p className="text-sm text-muted-foreground">Concluindo o cadastro do Android Enterprise...</p>
        )}
        {status === "ok" && (
          <p className="text-sm text-card-foreground">
            Enterprise configurada com sucesso. Voltando para o painel...
          </p>
        )}
        {status === "erro" && (
          <>
            <p className="text-sm text-destructive">{errorMessage}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Volte ao painel e inicie o cadastro novamente.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
