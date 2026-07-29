import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="surface-card mx-auto flex max-w-lg flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="flex size-9 items-center justify-center rounded-full border border-border bg-surface-sunken text-subtle">
        <SearchX className="size-4" />
      </span>

      <div className="space-y-1">
        <h1 className="text-[15px] font-semibold">Registro não encontrado</h1>
        <p className="text-[12.5px] leading-relaxed text-muted">
          O lançamento, corretor ou página que você tentou abrir não existe, foi excluído ou
          pertence a outra organização.
        </p>
      </div>

      <div className="mt-1 flex flex-wrap justify-center gap-2">
        <Button asChild size="sm">
          <Link href="/dashboard">Ir para o dashboard</Link>
        </Button>
        <Button asChild variant="secondary" size="sm">
          <Link href="/lixeira">Ver registros excluídos</Link>
        </Button>
      </div>
    </div>
  );
}
