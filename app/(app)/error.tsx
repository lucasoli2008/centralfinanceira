"use client";

import * as React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Erro inesperado dentro da área autenticada.
 * A mensagem técnica nunca é exibida ao usuário — apenas registrada no console
 * do servidor/navegador para diagnóstico.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error(JSON.stringify({ scope: "central-financeira", context: "render", digest: error.digest }));
  }, [error]);

  return (
    <div className="surface-card mx-auto flex max-w-lg flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="flex size-9 items-center justify-center rounded-full bg-danger-soft text-danger">
        <AlertTriangle className="size-4" />
      </span>

      <div className="space-y-1">
        <h1 className="text-[15px] font-semibold">Algo não carregou como esperado</h1>
        <p className="text-[12.5px] leading-relaxed text-muted">
          Nenhum dado foi alterado. Tente carregar a página novamente; se o problema continuar,
          avise o responsável pelo sistema.
        </p>
      </div>

      <div className="mt-1 flex flex-wrap justify-center gap-2">
        <Button size="sm" onClick={reset}>
          <RotateCcw />
          Tentar novamente
        </Button>
        <Button asChild variant="secondary" size="sm">
          <a href="/dashboard">Ir para o dashboard</a>
        </Button>
      </div>

      {error.digest ? (
        <p className="mt-1 text-[11px] text-subtle">Código de referência: {error.digest}</p>
      ) : null}
    </div>
  );
}
