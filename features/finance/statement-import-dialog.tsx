"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout, Checkbox, FormField, Input, NativeSelect } from "@/components/ui/field";
import { MoneyInput } from "@/components/finance/money-input";
import { Table, TableWrapper, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/formatting/number";
import { formatDate } from "@/lib/formatting/date";
import { cn } from "@/lib/utils";
import {
  decodeStatementFile,
  guessCsvMapping,
  parseCsvStatement,
  parseOfx,
  readCsvTable,
  type CsvMapping,
  type CsvTable,
  type ParsedStatement,
} from "@/lib/finance/statement-parsers";
import { importStatement } from "./automation-actions";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

type Loaded =
  | { kind: "ofx"; fileName: string; statement: ParsedStatement }
  | { kind: "csv"; fileName: string; table: CsvTable };

export function StatementImportButton({ accountId, accountName }: { accountId: string; accountName: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Upload />
        Importar extrato
      </Button>
      {open ? <StatementImportDialog accountId={accountId} accountName={accountName} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ColumnSelect({
  id,
  label,
  headers,
  value,
  onChange,
  optional = false,
}: {
  id: string;
  label: string;
  headers: string[];
  value: number | null;
  onChange: (value: number | null) => void;
  optional?: boolean;
}) {
  return (
    <FormField label={label} htmlFor={id}>
      <NativeSelect id={id} value={value === null ? "" : String(value)} onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}>
        {optional ? <option value="">Não usar</option> : null}
        {headers.map((header, index) => (
          <option key={`${header}-${index}`} value={index}>
            {header}
          </option>
        ))}
      </NativeSelect>
    </FormField>
  );
}

function StatementImportDialog({ accountId, accountName, onClose }: { accountId: string; accountName: string; onClose: () => void }) {
  const router = useRouter();
  const [loaded, setLoaded] = React.useState<Loaded | null>(null);
  const [mapping, setMapping] = React.useState<CsvMapping | null>(null);
  const [amountMode, setAmountMode] = React.useState<"single" | "split">("single");
  const [balance, setBalance] = React.useState<number | null>(null);
  const [balanceDate, setBalanceDate] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onFile(file: File | undefined) {
    setError(null);
    setLoaded(null);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError("O arquivo tem mais de 5 MB. Exporte um período menor.");
      return;
    }
    try {
      const text = decodeStatementFile(await file.arrayBuffer());
      if (/<OFX>/i.test(text) || /\.ofx$/i.test(file.name)) {
        const statement = parseOfx(text);
        setLoaded({ kind: "ofx", fileName: file.name, statement });
        setBalance(statement.balance);
        setBalanceDate(statement.balanceDate ?? "");
      } else {
        const table = readCsvTable(text);
        if (table.rows.length === 0) throw new Error("Não encontramos linhas de transação no arquivo.");
        const guessed = guessCsvMapping(table.headers);
        setMapping(guessed);
        setAmountMode(guessed.amount === null ? "split" : "single");
        setLoaded({ kind: "csv", fileName: file.name, table });
        setBalance(null);
        setBalanceDate("");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível ler o arquivo.");
    }
  }

  const statement: ParsedStatement | null = React.useMemo(() => {
    if (!loaded) return null;
    if (loaded.kind === "ofx") return loaded.statement;
    if (!mapping) return null;
    const effective: CsvMapping =
      amountMode === "single"
        ? { ...mapping, credit: null, debit: null, amount: mapping.amount ?? 0 }
        : { ...mapping, amount: null, credit: mapping.credit ?? 0, debit: mapping.debit ?? 0 };
    return parseCsvStatement(loaded.table, effective);
  }, [loaded, mapping, amountMode]);

  const totals = React.useMemo(() => {
    const lines = statement?.lines ?? [];
    return {
      count: lines.length,
      inflow: lines.filter((line) => line.amount > 0).reduce((sum, line) => sum + line.amount, 0),
      outflow: lines.filter((line) => line.amount < 0).reduce((sum, line) => sum - line.amount, 0),
    };
  }, [statement]);

  async function submit() {
    if (!statement || !loaded) return;
    setPending(true);
    const result = await importStatement({
      accountId,
      fileName: loaded.fileName,
      format: statement.format,
      balance,
      balanceDate: balance === null ? null : balanceDate || statement.periodEnd,
      periodStart: statement.periodStart,
      periodEnd: statement.periodEnd,
      lines: statement.lines,
    });
    setPending(false);
    if (result.status === "error") {
      toast.error(result.message);
      return;
    }
    const { inserted, duplicated } = result.data;
    toast.success(
      inserted === 0
        ? "Nenhuma transação nova — todas já estavam importadas."
        : `${inserted} transação(ões) importada(s)${duplicated ? `; ${duplicated} já existiam e foram ignoradas` : ""}.`,
    );
    onClose();
    router.refresh();
  }

  const update = (patch: Partial<CsvMapping>) => setMapping((current) => (current ? { ...current, ...patch } : current));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Importar extrato — {accountName}</DialogTitle>
          <DialogDescription>
            Arquivo OFX ou CSV exportado do internet banking. Importar não altera nenhum saldo: as transações ficam aguardando
            conciliação. Reimportar o mesmo período não duplica nada.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border-strong px-4 py-4 text-[13px] transition-colors hover:bg-surface-muted",
              loaded && "border-solid",
            )}
          >
            <FileUp className="size-5 text-subtle" />
            <span className="flex-1">
              {loaded ? (
                <>
                  <strong>{loaded.fileName}</strong>
                  <span className="block text-[12px] text-muted">{loaded.kind.toUpperCase()} · clique para trocar</span>
                </>
              ) : (
                <>
                  <strong>Escolher arquivo</strong>
                  <span className="block text-[12px] text-muted">.ofx ou .csv, até 5 MB</span>
                </>
              )}
            </span>
            <input
              type="file"
              accept=".ofx,.csv,.txt,text/csv,application/x-ofx"
              className="sr-only"
              onChange={(event) => onFile(event.target.files?.[0])}
            />
          </label>

          {error ? <Callout tone="danger">{error}</Callout> : null}

          {loaded?.kind === "csv" && mapping ? (
            <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-3">
              <ColumnSelect id="csv-date" label="Coluna da data" headers={loaded.table.headers} value={mapping.date} onChange={(value) => update({ date: value ?? 0 })} />
              <ColumnSelect
                id="csv-description"
                label="Coluna da descrição"
                headers={loaded.table.headers}
                value={mapping.description}
                onChange={(value) => update({ description: value ?? 0 })}
              />
              <FormField label="Formato da data" htmlFor="csv-date-order">
                <NativeSelect id="csv-date-order" value={mapping.dateOrder} onChange={(event) => update({ dateOrder: event.target.value as "dmy" | "mdy" })}>
                  <option value="dmy">dia/mês/ano</option>
                  <option value="mdy">mês/dia/ano</option>
                </NativeSelect>
              </FormField>
              <FormField label="Valores" htmlFor="csv-amount-mode">
                <NativeSelect id="csv-amount-mode" value={amountMode} onChange={(event) => setAmountMode(event.target.value as "single" | "split")}>
                  <option value="single">Uma coluna (com sinal)</option>
                  <option value="split">Crédito e débito separados</option>
                </NativeSelect>
              </FormField>
              {amountMode === "single" ? (
                <ColumnSelect id="csv-amount" label="Coluna do valor" headers={loaded.table.headers} value={mapping.amount ?? 0} onChange={(value) => update({ amount: value ?? 0 })} />
              ) : (
                <>
                  <ColumnSelect id="csv-credit" label="Coluna de crédito" headers={loaded.table.headers} value={mapping.credit ?? 0} onChange={(value) => update({ credit: value ?? 0 })} />
                  <ColumnSelect id="csv-debit" label="Coluna de débito" headers={loaded.table.headers} value={mapping.debit ?? 0} onChange={(value) => update({ debit: value ?? 0 })} />
                </>
              )}
              <ColumnSelect id="csv-doc" label="Documento" headers={loaded.table.headers} value={mapping.document} onChange={(value) => update({ document: value })} optional />
              <label className="flex items-center gap-2 text-[12.5px] sm:col-span-3">
                <Checkbox checked={mapping.invert} onChange={(event) => update({ invert: event.target.checked })} />
                Inverter sinais (use se as saídas aparecerem como entradas)
              </label>
            </div>
          ) : null}

          {statement ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="surface-card px-3 py-2">
                  <p className="label-caption">Transações</p>
                  <p className="text-[15px] font-semibold tabular">{totals.count}</p>
                  {statement.periodStart ? (
                    <p className="text-[11.5px] text-subtle">
                      {formatDate(statement.periodStart)} a {formatDate(statement.periodEnd ?? statement.periodStart)}
                    </p>
                  ) : null}
                </div>
                <div className="surface-card px-3 py-2">
                  <p className="label-caption">Entradas</p>
                  <p className="text-[15px] font-semibold tabular text-info">{formatCurrency(totals.inflow)}</p>
                </div>
                <div className="surface-card px-3 py-2">
                  <p className="label-caption">Saídas</p>
                  <p className="text-[15px] font-semibold tabular">{formatCurrency(totals.outflow)}</p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  label="Saldo final do extrato"
                  htmlFor="stmt-balance"
                  hint={loaded?.kind === "ofx" ? "Lido do arquivo." : "Opcional — permite comparar com o saldo do sistema."}
                >
                  <MoneyInput id="stmt-balance" value={balance} onChange={setBalance} />
                </FormField>
                <FormField label="Data do saldo" htmlFor="stmt-balance-date">
                  <Input id="stmt-balance-date" type="date" value={balanceDate} onChange={(event) => setBalanceDate(event.target.value)} disabled={balance === null} />
                </FormField>
              </div>

              {statement.warnings.length ? (
                <Callout tone="warning">
                  {statement.warnings.map((warning) => (
                    <span key={warning} className="block">
                      {warning}
                    </span>
                  ))}
                </Callout>
              ) : null}

              <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
                <TableWrapper>
                  <Table>
                    <caption className="sr-only">Prévia das transações</caption>
                    <THead>
                      <TR>
                        <TH>Data</TH>
                        <TH>Descrição</TH>
                        <TH numeric>Valor</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {statement.lines.slice(0, 50).map((line) => (
                        <TR key={line.externalId}>
                          <TD className="whitespace-nowrap tabular">{formatDate(line.postedOn)}</TD>
                          <TD className="max-w-[360px] truncate">{line.description}</TD>
                          <TD numeric className={line.amount > 0 ? "text-info" : undefined}>
                            {formatCurrency(line.amount)}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableWrapper>
              </div>
              {statement.lines.length > 50 ? (
                <p className="text-[11.5px] text-subtle">Mostrando 50 de {statement.lines.length} transações.</p>
              ) : null}
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending || !statement || statement.lines.length === 0}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Importar {statement ? `${statement.lines.length} transação(ões)` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
