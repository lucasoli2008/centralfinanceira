"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Callout, Checkbox, FormField, Input, NativeSelect } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableWrapper, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";
import { MetricCard } from "@/components/finance/metric-card";
import { confirmImport, previewImport, type ConfirmImportInput } from "./actions";
import type { ImportPreview } from "@/server/import/parse-spreadsheet";
import { formatCurrency, formatInteger, formatPercent } from "@/lib/formatting/number";
import { formatDate, monthName } from "@/lib/formatting/date";
import { PROPERTY_TYPE_LABELS } from "@/lib/formatting/labels";

type Step = "upload" | "review" | "done";

interface BrokerDecision {
  include: boolean;
}

export function ImportWizard() {
  const router = useRouter();
  const currentYear = new Date().getFullYear();

  const [step, setStep] = React.useState<Step>("upload");
  const [pending, setPending] = React.useState(false);
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [decisions, setDecisions] = React.useState<Record<string, BrokerDecision>>({});
  const [result, setResult] = React.useState<{ importId: string; entriesCount: number } | null>(null);

  async function onUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    setPending(true);
    const response = await previewImport(formData);
    setPending(false);

    if (response.status === "error") {
      toast.error(response.message);
      return;
    }

    setPreview(response.data);
    setDecisions(
      Object.fromEntries(response.data.brokers.map((broker) => [broker.key, { include: true }])),
    );
    setStep("review");
  }

  async function onConfirm() {
    if (!preview) return;

    const payload: ConfirmImportInput = {
      filename: preview.filename,
      year: preview.year,
      entryType: preview.entryType,
      brokers: preview.brokers.map((broker) => ({
        key: broker.key,
        name: broker.name,
        existingBrokerId: broker.existingBrokerId,
        include: decisions[broker.key]?.include ?? true,
      })),
      rows: preview.rows.map((row) => ({
        id: row.id,
        entryDate: row.entryDate,
        description: row.description,
        reference: row.reference,
        propertyType: row.propertyType,
        baseAmount: row.baseAmount,
        commissionRate: row.commissionRate,
        brokerKey: row.brokerName
          ? (preview.brokers.find((broker) => broker.name === row.brokerName)?.key ?? null)
          : null,
        splitRate: row.splitRate,
      })),
    };

    setPending(true);
    const response = await confirmImport(payload);
    setPending(false);

    if (response.status === "error") {
      toast.error(response.message);
      return;
    }

    setResult(response.data);
    setStep("done");
    toast.success(`${response.data.entriesCount} lançamentos importados.`);
    router.refresh();
  }

  if (step === "done" && result) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 pt-10 text-center">
          <span className="flex size-9 items-center justify-center rounded-full bg-positive-soft text-positive">
            <CheckCircle2 className="size-4" />
          </span>
          <div className="space-y-1">
            <p className="text-[15px] font-semibold">Importação concluída</p>
            <p className="mx-auto max-w-md text-[12.5px] leading-relaxed text-muted">
              {formatInteger(result.entriesCount)} lançamentos entraram na base, já recalculados
              pelo motor financeiro. A importação ficou registrada na auditoria e pode ser desfeita
              enquanto os meses estiverem abertos.
            </p>
          </div>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            <Button size="sm" onClick={() => router.push("/dashboard")}>
              Ver no dashboard
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setStep("upload");
                setPreview(null);
                setResult(null);
              }}
            >
              Importar outra planilha
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (step === "review" && preview) {
    const rowsWithWarnings = preview.rows.filter((row) => row.warnings.length > 0);
    const newBrokers = preview.brokers.filter((broker) => !broker.existingBrokerId);

    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Lançamentos a importar"
            value={formatInteger(preview.totals.entries)}
            hint={`${preview.sheetsDetected.filter((sheet) => sheet.rows > 0).length} meses com movimento`}
            emphasis
          />
          <MetricCard
            label="Comissão bruta recalculada"
            value={formatCurrency(preview.totals.grossCommission)}
            hint="Calculada pelo novo motor"
          />
          <MetricCard
            label="Repasses aos corretores"
            value={formatCurrency(preview.totals.brokerPayout)}
            hint="Somados linha a linha"
          />
          <MetricCard
            label="Receita líquida"
            value={formatCurrency(preview.totals.netRevenue)}
            hint="Bruta − repasses"
          />
        </div>

        <Callout tone="info">
          <FileSpreadsheet className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Nenhum total da planilha foi aproveitado: comissões, repasses e receita líquida acima
            foram recalculados. Como a planilha não tem coluna de data, a data da entrada usa o mês
            da aba com o ano <strong>{preview.year}</strong>.
          </span>
        </Callout>

        {newBrokers.length > 0 ? (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Corretores encontrados</CardTitle>
                <CardDescription>
                  Nomes iguais (ignorando acentos, caixa e espaços) foram agrupados. Desmarque para
                  importar o lançamento sem repasse.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border">
                {preview.brokers.map((broker) => (
                  <li key={broker.key} className="flex items-center justify-between gap-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Checkbox
                        id={`broker-${broker.key}`}
                        checked={decisions[broker.key]?.include ?? true}
                        onChange={(event) =>
                          setDecisions((current) => ({
                            ...current,
                            [broker.key]: { include: event.target.checked },
                          }))
                        }
                      />
                      <label htmlFor={`broker-${broker.key}`} className="cursor-pointer">
                        <span className="text-[13px] font-medium">{broker.name}</span>
                        <span className="ml-2 text-[11.5px] text-subtle">
                          {broker.rowCount} lançamento{broker.rowCount > 1 ? "s" : ""}
                        </span>
                      </label>
                    </div>

                    {broker.existingBrokerId ? (
                      <Badge tone="positive">Já cadastrado</Badge>
                    ) : (
                      <Badge tone="accent">Será criado</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {rowsWithWarnings.length > 0 ? (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Pontos de atenção ({rowsWithWarnings.length})</CardTitle>
                <CardDescription>
                  A importação pode seguir, mas confira estas linhas antes de confirmar.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {rowsWithWarnings.map((row) => (
                  <li key={row.id} className="flex items-start gap-2 text-[12.5px]">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                    <span>
                      <strong>
                        {row.sheet} · linha {row.sourceRow}
                      </strong>{" "}
                      — {row.description}: {row.warnings.join(" ")}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {preview.skipped.length > 0 ? (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Linhas descartadas ({preview.skipped.length})</CardTitle>
                <CardDescription>
                  Linhas de total, vazias ou sem valor não entram na base.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted">
                {preview.skipped.slice(0, 24).map((row) => (
                  <li key={`${row.sheet}-${row.sourceRow}`}>
                    {row.sheet} · linha {row.sourceRow}: {row.reason}
                  </li>
                ))}
                {preview.skipped.length > 24 ? (
                  <li>… e outras {preview.skipped.length - 24}.</li>
                ) : null}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <Card className="overflow-hidden">
          <CardHeader>
            <div>
              <CardTitle>Prévia dos lançamentos</CardTitle>
              <CardDescription>
                Abas lidas: {preview.sheetsDetected.map((sheet) => monthName(sheet.month)).join(", ")}.
                Abas ignoradas: {preview.sheetsIgnored.join(", ") || "nenhuma"}.
              </CardDescription>
            </div>
          </CardHeader>

          <TableWrapper>
            <Table>
              <caption className="sr-only">Lançamentos que serão importados</caption>
              <THead>
                <TR>
                  <TH>Origem</TH>
                  <TH>Data da entrada</TH>
                  <TH>Descrição</TH>
                  <TH>Imóvel</TH>
                  <TH numeric>Valor-base</TH>
                  <TH numeric>Comissão</TH>
                  <TH numeric>Bruta</TH>
                  <TH>Corretor</TH>
                  <TH numeric>Repasse</TH>
                  <TH numeric>Líquida</TH>
                </TR>
              </THead>
              <TBody>
                {preview.rows.map((row) => (
                  <TR key={row.id}>
                    <TD className="whitespace-nowrap text-subtle">
                      {row.sheet} · {row.sourceRow}
                    </TD>
                    <TD className="whitespace-nowrap">{formatDate(row.entryDate)}</TD>
                    <TD>
                      {row.description}
                      {row.warnings.length > 0 ? (
                        <AlertTriangle className="ml-1.5 inline size-3 text-warning" />
                      ) : null}
                    </TD>
                    <TD className="text-muted">{PROPERTY_TYPE_LABELS[row.propertyType]}</TD>
                    <TD numeric>{formatCurrency(row.baseAmount)}</TD>
                    <TD numeric>
                      {row.commissionRate === null ? "—" : formatPercent(row.commissionRate)}
                    </TD>
                    <TD numeric className="font-semibold">
                      {formatCurrency(row.grossCommission)}
                    </TD>
                    <TD className="text-muted">
                      {row.brokerName ?? "—"}
                      {row.splitRate !== null ? (
                        <span className="ml-1 text-subtle">({formatPercent(row.splitRate)})</span>
                      ) : null}
                    </TD>
                    <TD numeric>{formatCurrency(row.brokerPayout)}</TD>
                    <TD numeric className="font-semibold">
                      {formatCurrency(row.netRevenue)}
                    </TD>
                  </TR>
                ))}
              </TBody>
              <TFoot>
                <TR className="hover:bg-transparent">
                  <TD colSpan={6}>Total recalculado</TD>
                  <TD numeric>{formatCurrency(preview.totals.grossCommission)}</TD>
                  <TD />
                  <TD numeric>{formatCurrency(preview.totals.brokerPayout)}</TD>
                  <TD numeric>{formatCurrency(preview.totals.netRevenue)}</TD>
                </TR>
              </TFoot>
            </Table>
          </TableWrapper>
        </Card>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onConfirm} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Upload />}
            Confirmar importação de {formatInteger(preview.totals.entries)} lançamentos
          </Button>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setStep("upload");
              setPreview(null);
            }}
          >
            <ArrowLeft />
            Escolher outro arquivo
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Selecionar planilha</CardTitle>
          <CardDescription>
            Envie o arquivo .xlsx usado hoje. Nada é gravado até você revisar a prévia e confirmar.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent>
        <form onSubmit={onUpload} className="space-y-4">
          <FormField
            label="Arquivo da planilha"
            htmlFor="arquivo"
            required
            hint="Formato .xlsx, até 8 MB. As abas de configuração, dashboard e relatório são ignoradas."
          >
            <Input
              id="arquivo"
              name="arquivo"
              type="file"
              accept=".xlsx,.xlsm"
              required
              className="h-auto py-1.5 file:mr-3 file:rounded-md file:border-0 file:bg-surface-muted file:px-2.5 file:py-1 file:text-[12.5px] file:font-medium"
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-3">
            <FormField
              label="Ano financeiro"
              htmlFor="ano"
              required
              hint="A planilha guarda só o mês."
            >
              <NativeSelect id="ano" name="ano" defaultValue={String(currentYear)}>
                {[currentYear + 1, currentYear, currentYear - 1, currentYear - 2].map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </NativeSelect>
            </FormField>

            <FormField label="Dia da entrada" htmlFor="dia" hint="Usado em todas as linhas.">
              <NativeSelect id="dia" name="dia" defaultValue="1">
                {[1, 5, 10, 15, 20, 25, 28].map((day) => (
                  <option key={day} value={day}>
                    Dia {day}
                  </option>
                ))}
              </NativeSelect>
            </FormField>

            <FormField label="Tipo de entrada" htmlFor="tipo" hint="Aplicado a todas as linhas.">
              <NativeSelect id="tipo" name="tipo" defaultValue="sale">
                <option value="sale">Venda</option>
                <option value="rental">Locação</option>
              </NativeSelect>
            </FormField>
          </div>

          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet />}
            {pending ? "Lendo planilha…" : "Ler planilha e ver prévia"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
