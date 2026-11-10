"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, CheckCheck, Link2, Loader2, Sparkles, Undo2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout, Checkbox, FormField, Input, NativeSelect } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { EmptyState } from "@/components/ui/states";
import { Table, TableWrapper, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
import { CategoryOptions } from "./entry-sheet";
import { ReasonDialog } from "./reason-dialog";
import { useUpdateSearchParams } from "./finance-filters";
import {
  confirmReconciliationSuggestions,
  createFromRules,
  createFromStatementLine,
  ignoreStatementLine,
  loadLineCandidates,
  matchStatementLine,
  settleFromStatementLine,
  unmatchStatementLine,
} from "./automation-actions";
import type { FinLookups } from "@/server/queries/finance";
import type { FinAccountMovementRow, FinLineCandidateRow, FinStatementLineListRow } from "@/types/database";

type StatusFilter = "pending" | "matched" | "ignored" | "all";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "pending", label: "Pendentes" },
  { value: "matched", label: "Conciliadas" },
  { value: "ignored", label: "Ignoradas" },
  { value: "all", label: "Todas" },
];

function AmountCell({ amount }: { amount: number }) {
  return <span className={cn("font-medium tabular", amount > 0 ? "text-info" : "text-foreground")}>{formatCurrency(amount)}</span>;
}

export function ReconciliationBoard({
  accountId,
  lines,
  status,
  lookups,
  canWrite,
  suggestionCount,
  unmatchedMovements,
}: {
  accountId: string;
  lines: FinStatementLineListRow[];
  status: StatusFilter;
  lookups: FinLookups;
  canWrite: boolean;
  suggestionCount: number;
  unmatchedMovements: FinAccountMovementRow[];
}) {
  const router = useRouter();
  const update = useUpdateSearchParams();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [resolving, setResolving] = React.useState<FinStatementLineListRow | null>(null);
  const [ignoring, setIgnoring] = React.useState<FinStatementLineListRow | null>(null);
  const [rulesOpen, setRulesOpen] = React.useState(false);

  const ruleLines = lines.filter((line) => line.status === "pending" && line.rule_id && !line.suggested_entry_id);

  async function run(key: string, action: () => Promise<{ status: string; message?: string }>, success: string) {
    setBusy(key);
    const result = await action();
    setBusy(null);
    if (result.status === "error") {
      toast.error(result.message ?? "Não foi possível concluir.");
      return false;
    }
    toast.success(success);
    router.refresh();
    return true;
  }

  async function confirmAll() {
    setBusy("all");
    const result = await confirmReconciliationSuggestions(accountId);
    setBusy(null);
    if (result.status === "error") {
      toast.error(result.message);
      return;
    }
    toast.success(`${result.data.count} linha(s) conciliada(s).`);
    router.refresh();
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Segmented
          ariaLabel="Situação das linhas do extrato"
          options={STATUS_OPTIONS}
          value={status}
          onChange={(value) => update({ situacao: value === "pending" ? null : value })}
        />
        {canWrite && status === "pending" ? (
          <div className="flex flex-wrap gap-2">
            {ruleLines.length ? (
              <Button variant="secondary" onClick={() => setRulesOpen(true)}>
                <Wand2 />
                Criar {ruleLines.length} pela regra
              </Button>
            ) : null}
            {suggestionCount ? (
              <Button onClick={confirmAll} disabled={busy === "all"}>
                {busy === "all" ? <Loader2 className="size-4 animate-spin" /> : <CheckCheck />}
                Confirmar {suggestionCount} sugestão(ões)
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="surface-card overflow-hidden">
        {lines.length === 0 ? (
          <EmptyState
            icon="inbox"
            title={status === "pending" ? "Nenhuma linha pendente." : "Nada por aqui."}
            description={
              status === "pending"
                ? "Importe um extrato OFX ou CSV para conciliar as transações do banco com os lançamentos."
                : "Mude o filtro para ver outras linhas."
            }
          />
        ) : (
          <TableWrapper>
            <Table>
              <caption className="sr-only">Linhas do extrato bancário</caption>
              <THead>
                <TR>
                  <TH>Data</TH>
                  <TH>Descrição no banco</TH>
                  <TH numeric>Valor</TH>
                  <TH>No sistema</TH>
                  <TH className="w-44">
                    <span className="sr-only">Ações</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {lines.map((line) => (
                  <TR key={line.id}>
                    <TD className="whitespace-nowrap tabular">{formatDate(line.posted_on)}</TD>
                    <TD>
                      <span className="block max-w-[340px] truncate font-medium" title={line.description}>
                        {line.description}
                      </span>
                      {line.memo ? <span className="block max-w-[340px] truncate text-[11.5px] text-subtle">{line.memo}</span> : null}
                    </TD>
                    <TD numeric>
                      <AmountCell amount={line.amount} />
                    </TD>
                    <TD className="text-[12.5px]">
                      {line.status === "matched" ? (
                        <Link
                          href={`/financeiro/lancamentos?lancamento=${line.matched_entry_id}`}
                          className="flex items-center gap-1.5 text-positive hover:underline"
                        >
                          <Check className="size-3.5" />
                          <span className="truncate">{line.matched_description ?? "Conciliada"}</span>
                        </Link>
                      ) : line.status === "ignored" ? (
                        <span className="text-subtle" title={line.ignore_reason ?? undefined}>
                          Ignorada · {line.ignore_reason}
                        </span>
                      ) : line.suggested_entry_id ? (
                        <span className="flex items-center gap-1.5 text-info">
                          <Sparkles className="size-3.5" />
                          <span className="truncate">
                            {line.suggested_description}
                            {line.suggested_day_diff ? ` · ${line.suggested_day_diff} dia(s) de diferença` : " · mesma data"}
                          </span>
                        </span>
                      ) : line.rule_id ? (
                        <span className="flex items-center gap-1.5 text-muted">
                          <Wand2 className="size-3.5" />
                          <span className="truncate">
                            Regra “{line.rule_name}” → {line.rule_category_name}
                          </span>
                        </span>
                      ) : (
                        <span className="text-subtle">Sem correspondência</span>
                      )}
                    </TD>
                    <TD>
                      {!canWrite ? null : line.status === "pending" ? (
                        <div className="flex justify-end gap-1">
                          {line.suggested_entry_id ? (
                            <Button
                              size="sm"
                              disabled={busy === line.id}
                              onClick={() =>
                                run(
                                  line.id,
                                  () => matchStatementLine(line.id, line.suggested_entry_id!, line.suggested_settlement_id),
                                  "Linha conciliada.",
                                )
                              }
                            >
                              {busy === line.id ? <Loader2 className="size-4 animate-spin" /> : <Link2 />}
                              Conciliar
                            </Button>
                          ) : null}
                          <Button size="sm" variant="secondary" onClick={() => setResolving(line)}>
                            Resolver
                          </Button>
                        </div>
                      ) : (
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy === line.id}
                            onClick={() =>
                              run(line.id, () => unmatchStatementLine(line.id), line.status === "matched" ? "Conciliação desfeita." : "Linha restaurada.")
                            }
                          >
                            <Undo2 />
                            {line.status === "matched" ? "Desfazer" : "Restaurar"}
                          </Button>
                        </div>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </div>

      {unmatchedMovements.length ? (
        <section className="surface-card mt-5">
          <header className="border-b border-border px-4 py-3">
            <p className="text-[13.5px] font-semibold">Movimentos do sistema sem linha no extrato</p>
            <p className="text-[12px] text-muted">
              Lançados nas datas cobertas pelo extrato, mas sem transação correspondente no banco. Pode ser lançamento em
              duplicidade, data errada ou valor diferente.
            </p>
          </header>
          <ul className="divide-y divide-border">
            {unmatchedMovements.map((movement) => (
              <li key={`${movement.entry_id}-${movement.settlement_id ?? "m"}`} className="flex items-center justify-between gap-3 px-4 py-2 text-[13px]">
                <Link href={`/financeiro/lancamentos?lancamento=${movement.entry_id}`} className="min-w-0 hover:underline">
                  <span className="block truncate">{movement.description}</span>
                  <span className="text-[11.5px] text-subtle">{formatDate(movement.movement_date)}</span>
                </Link>
                <AmountCell amount={movement.signed_amount} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {resolving ? (
        <LineResolveSheet
          line={resolving}
          accountId={accountId}
          lookups={lookups}
          onClose={() => setResolving(null)}
          onIgnore={() => {
            setIgnoring(resolving);
            setResolving(null);
          }}
        />
      ) : null}

      <ReasonDialog
        open={Boolean(ignoring)}
        title="Ignorar linha do extrato"
        description="A linha deixa de aparecer como pendente, sem gerar lançamento. Explique o motivo — fica registrado na auditoria."
        confirmLabel="Ignorar linha"
        onClose={() => setIgnoring(null)}
        onConfirm={async (reason) => {
          if (!ignoring) return false;
          return run(ignoring.id, () => ignoreStatementLine(ignoring.id, reason), "Linha ignorada.");
        }}
      />

      {rulesOpen ? <RulesReviewDialog lines={ruleLines} onClose={() => setRulesOpen(false)} /> : null}
    </>
  );
}

/** Revisão antes de criar lançamentos pelas regras — nada é criado sem confirmação. */
function RulesReviewDialog({ lines, onClose }: { lines: FinStatementLineListRow[]; onClose: () => void }) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(lines.map((line) => line.id)));
  const [pending, setPending] = React.useState(false);

  async function submit() {
    setPending(true);
    const result = await createFromRules([...selected]);
    setPending(false);
    if (result.status === "error") {
      toast.error(result.message);
      return;
    }
    toast.success(`${result.data.count} lançamento(s) criado(s) e conciliado(s).`);
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Criar lançamentos pelas regras</DialogTitle>
          <DialogDescription>
            Cada linha marcada vira um lançamento já pago/recebido na categoria da regra e fica conciliada. Desmarque o que não
            quiser criar.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
          <ul className="divide-y divide-border">
            {lines.map((line) => (
              <li key={line.id}>
                <label className="flex items-center gap-3 px-3 py-2 text-[13px]">
                  <Checkbox
                    checked={selected.has(line.id)}
                    onChange={(event) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(line.id);
                        else next.delete(line.id);
                        return next;
                      })
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{line.description}</span>
                    <span className="text-[11.5px] text-subtle">
                      {formatDate(line.posted_on)} · {line.rule_category_name} (regra “{line.rule_name}”)
                    </span>
                  </span>
                  <AmountCell amount={line.amount} />
                </label>
              </li>
            ))}
          </ul>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending || selected.size === 0}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Criar {selected.size} lançamento(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LineResolveSheet({
  line,
  accountId,
  lookups,
  onClose,
  onIgnore,
}: {
  line: FinStatementLineListRow;
  accountId: string;
  lookups: FinLookups;
  onClose: () => void;
  onIgnore: () => void;
}) {
  const router = useRouter();
  const direction = line.amount > 0 ? "income" : "expense";
  const [candidates, setCandidates] = React.useState<FinLineCandidateRow[] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [kind, setKind] = React.useState<"income" | "expense" | "transfer">(direction);
  const [description, setDescription] = React.useState(line.description);
  const [categoryId, setCategoryId] = React.useState(line.rule_category_id ?? "");
  const [counterpartyId, setCounterpartyId] = React.useState("");
  const [costCenterId, setCostCenterId] = React.useState("");
  const [otherAccountId, setOtherAccountId] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    loadLineCandidates(line.id).then((rows) => {
      if (alive) setCandidates(rows);
    });
    return () => {
      alive = false;
    };
  }, [line.id]);

  async function finish(key: string, action: () => Promise<{ status: string; message?: string }>, success: string) {
    setBusy(key);
    const result = await action();
    setBusy(null);
    if (result.status === "error") {
      toast.error(result.message ?? "Não foi possível concluir.");
      return;
    }
    toast.success(success);
    onClose();
    router.refresh();
  }

  const movements = candidates?.filter((row) => row.candidate_type === "movement") ?? [];
  const openEntries = candidates?.filter((row) => row.candidate_type === "open_entry") ?? [];
  const otherAccounts = lookups.accounts.filter((account) => account.id !== accountId);

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent width="lg">
        <SheetHeader>
          <SheetTitle>Resolver linha do extrato</SheetTitle>
          <SheetDescription>
            {formatDate(line.posted_on)} · {line.description} · <AmountCell amount={line.amount} />
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-6">
          {candidates === null ? (
            <p className="flex items-center gap-2 text-[13px] text-muted">
              <Loader2 className="size-4 animate-spin" /> Procurando correspondências…
            </p>
          ) : (
            <>
              <section>
                <h3 className="mb-1 text-[13px] font-semibold">1. Já está lançado e pago no sistema?</h3>
                <p className="mb-2 text-[12px] text-muted">Movimentos desta conta com o mesmo valor, até 10 dias de diferença.</p>
                {movements.length === 0 ? (
                  <p className="text-[12.5px] text-subtle">Nenhum movimento com o mesmo valor.</p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {movements.map((row) => (
                      <li key={`${row.entry_id}-${row.settlement_id}`} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{row.description}</span>
                          <span className="text-[11.5px] text-subtle">
                            {formatDate(row.ref_date)}
                            {row.counterparty_name ? ` · ${row.counterparty_name}` : ""}
                            {row.day_diff ? ` · ${row.day_diff} dia(s) de diferença` : ""}
                          </span>
                        </span>
                        <Button
                          size="sm"
                          disabled={Boolean(busy)}
                          onClick={() => finish(row.entry_id, () => matchStatementLine(line.id, row.entry_id, row.settlement_id), "Linha conciliada.")}
                        >
                          {busy === row.entry_id ? <Loader2 className="size-4 animate-spin" /> : <Link2 />}
                          Conciliar
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="mb-1 text-[13px] font-semibold">
                  2. É o {direction === "income" ? "recebimento" : "pagamento"} de uma conta em aberto?
                </h3>
                <p className="mb-2 text-[12px] text-muted">
                  {direction === "income" ? "Contas a receber" : "Contas a pagar"} (inclusive previsões) com saldo suficiente e
                  vencimento próximo. A baixa usa a data e o valor do banco.
                </p>
                {openEntries.length === 0 ? (
                  <p className="text-[12.5px] text-subtle">Nenhuma conta em aberto compatível.</p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {openEntries.map((row) => (
                      <li key={row.entry_id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate font-medium">{row.description}</span>
                            {row.exact ? <Badge tone="positive">Valor exato</Badge> : <Badge tone="neutral">Baixa parcial</Badge>}
                          </span>
                          <span className="text-[11.5px] text-subtle">
                            Vence {formatDate(row.ref_date)} · em aberto {formatCurrency(row.remaining)}
                            {row.counterparty_name ? ` · ${row.counterparty_name}` : ""}
                          </span>
                        </span>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={Boolean(busy)}
                          onClick={() => finish(row.entry_id, () => settleFromStatementLine(line.id, row.entry_id), "Baixa registrada e linha conciliada.")}
                        >
                          {busy === row.entry_id ? <Loader2 className="size-4 animate-spin" /> : null}
                          Baixar com esta linha
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}

          <section>
            <h3 className="mb-1 text-[13px] font-semibold">3. Criar um lançamento novo</h3>
            <p className="mb-3 text-[12px] text-muted">
              Registrado como já {direction === "income" ? "recebido" : "pago"} nesta conta, na data do banco.
              {line.rule_name ? ` Sugestão da regra “${line.rule_name}”.` : ""}
            </p>
            <div className="space-y-3">
              <Segmented
                ariaLabel="Tipo do lançamento"
                options={[
                  { value: direction, label: direction === "income" ? "Entrada" : "Saída" },
                  { value: "transfer", label: "Transferência entre contas" },
                ]}
                value={kind}
                onChange={setKind}
              />
              <FormField label="Descrição" htmlFor="line-description">
                <Input id="line-description" value={description} onChange={(event) => setDescription(event.target.value)} />
              </FormField>
              {kind === "transfer" ? (
                <FormField label={direction === "income" ? "Veio da conta" : "Foi para a conta"} htmlFor="line-other-account" required>
                  <NativeSelect id="line-other-account" value={otherAccountId} onChange={(event) => setOtherAccountId(event.target.value)}>
                    <option value="">Selecione…</option>
                    {otherAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="Categoria" htmlFor="line-category" required className="sm:col-span-2">
                    <NativeSelect id="line-category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                      <CategoryOptions categories={lookups.categories} kind={direction} />
                    </NativeSelect>
                  </FormField>
                  <FormField label="Favorecido" htmlFor="line-counterparty">
                    <NativeSelect id="line-counterparty" value={counterpartyId} onChange={(event) => setCounterpartyId(event.target.value)}>
                      <option value="">Nenhum</option>
                      {lookups.counterparties.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormField>
                  <FormField label="Centro de custo" htmlFor="line-cost-center">
                    <NativeSelect id="line-cost-center" value={costCenterId} onChange={(event) => setCostCenterId(event.target.value)}>
                      <option value="">Nenhum</option>
                      {lookups.costCenters.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormField>
                </div>
              )}
              {kind === "transfer" && otherAccounts.length === 0 ? (
                <Callout tone="info">Cadastre outra conta para registrar transferências.</Callout>
              ) : null}
            </div>
          </section>
        </SheetBody>
        <SheetFooter className="sm:justify-between">
          <Button variant="ghost" onClick={onIgnore}>
            Ignorar linha
          </Button>
          <Button
            disabled={Boolean(busy) || (kind === "transfer" ? !otherAccountId : !categoryId)}
            onClick={() =>
              finish(
                "create",
                () =>
                  createFromStatementLine(line.id, {
                    kind,
                    description,
                    categoryId: kind === "transfer" ? "" : categoryId,
                    counterpartyId,
                    costCenterId,
                    otherAccountId: kind === "transfer" ? otherAccountId : "",
                    ruleId: kind !== "transfer" && line.rule_id && categoryId === line.rule_category_id ? line.rule_id : "",
                    notes: null,
                  }),
                "Lançamento criado e conciliado.",
              )
            }
          >
            {busy === "create" ? <Loader2 className="size-4 animate-spin" /> : null}
            Criar e conciliar
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
