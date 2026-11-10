import { FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Botões de exportação: abrem o relatório gerado no servidor com os mesmos filtros da tela. */
export function ExportLinks({
  tipo,
  params,
  pdf = true,
  xlsx = true,
}: {
  tipo: "dre" | "fluxo" | "lancamentos" | "fechamento";
  params: Record<string, string | undefined | null>;
  pdf?: boolean;
  xlsx?: boolean;
}) {
  const href = (formato: "pdf" | "xlsx") => {
    const query = new URLSearchParams({ tipo, formato });
    for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
    return `/api/financeiro/relatorios?${query.toString()}`;
  };
  return (
    <div className="flex gap-2">
      {pdf ? (
        <Button asChild variant="secondary" size="sm">
          <a href={href("pdf")} target="_blank" rel="noopener">
            <FileText />
            PDF
          </a>
        </Button>
      ) : null}
      {xlsx ? (
        <Button asChild variant="secondary" size="sm">
          <a href={href("xlsx")}>
            <FileSpreadsheet />
            Excel
          </a>
        </Button>
      ) : null}
    </div>
  );
}
