"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Loader2, Pencil, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, FormField, Input, NativeSelect, Textarea } from "@/components/ui/field";
import { MoneyInput } from "@/components/finance/money-input";
import { Segmented } from "@/components/ui/segmented";
import { EmptyState } from "@/components/ui/states";
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
import { formatDate, formatDateTime } from "@/lib/formatting/date";
import { FIN_PAYMENT_METHOD_LABELS } from "@/lib/formatting/labels";
import { FIN_PAYMENT_METHODS } from "@/lib/validation/finance";
import { cn } from "@/lib/utils";
import { CategoryOptions } from "./entry-sheet";
import { generateRecurrenceForecasts, saveFinRecurrence, saveFinRule } from "./automation-actions";
import { setRecurrenceValueMode } from "./simple-actions";
import type { FinLookups } from "@/server/queries/finance";
import type {
  FinRecurrenceFrequency,
  FinRecurrenceRow,
  FinRuleDirection,
  FinRuleMatchMode,
  FinRuleRow,
} from "@/types/database";

const DIRECTION_LABELS: Record<FinRuleDirection, string> = { any: "Entradas e saídas", income: "Entradas", expense: "Saídas" };
const MODE_LABELS: Record<FinRuleMatchMode, string> = { contains: "contém", starts_with: "começa com", equals: "é exatamente" };
const FREQUENCY_LABELS: Record<FinRecurrenceFrequency, string> = { monthly: "Mensal", quarterly: "Trimestral", yearly: "Anual" };

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function nameOf(list: { id: string; name: string }[], id: string | null) {
  return id ? (list.find((item) => item.id === id)?.name ?? "—") : null;
}

// -----------------------------------------------------------------------------
// Regras
// -----------------------------------------------------------------------------
export function RulesSection({ rules, lookups, canWrite }: { rules: FinRuleRow[]; lookups: FinLookups; canWrite: boolean }) {
  const [editing, setEditing] = React.useState<FinRuleRow | "new" | null>(null);

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold">Regras de categorização</h2>
          <p className="max-w-2xl text-[12.5px] text-muted">
            Quando a descrição de uma transação do extrato (ou de um lançamento novo) combina com a regra, sugerimos a
            categoria, o favorecido e o centro de custo. Nada é lançado sem a sua confirmação.
          </p>
        </div>
        {canWrite ? (
          <Button onClick={() => setEditing("new")}>
            <Plus />
            Nova regra
          </Button>
        ) : null}
      </div>
      <div className="surface-card overflow-hidden">
        {rules.length === 0 ? (
          <EmptyState
            title="Nenhuma regra criada."
            description="Ex.: descrição contém “TARIFA” → Tarifas bancárias; contém “ENEL” → Energia elétrica."
          />
        ) : (
          <TableWrapper>
            <Table>
              <caption className="sr-only">Regras de categorização</caption>
              <THead>
                <TR>
                  <TH className="w-14">Ordem</TH>
                  <TH>Regra</TH>
                  <TH>Quando</TH>
                  <TH>Aplica</TH>
                  <TH numeric>Usos</TH>
                  <TH className="w-10">
                    <span className="sr-only">Ações</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {rules.map((rule) => (
                  <TR key={rule.id} className={cn(!rule.is_active && "opacity-60")}>
                    <TD className="tabular text-muted">{rule.priority}</TD>
                    <TD>
                      <span className="font-medium">{rule.name}</span>
                      {!rule.is_active ? <Badge tone="neutral" className="ml-2">Inativa</Badge> : null}
                    </TD>
                    <TD className="text-[12.5px] text-muted">
                      {DIRECTION_LABELS[rule.match_direction]} cuja descrição {MODE_LABELS[rule.match_mode]} “{rule.match_text}”
                      {rule.match_account_id ? ` · conta ${nameOf(lookups.accounts, rule.match_account_id)}` : ""}
                      {rule.amount_min !== null || rule.amount_max !== null
                        ? ` · valor ${rule.amount_min !== null ? `≥ ${formatCurrency(rule.amount_min)}` : ""}${rule.amount_min !== null && rule.amount_max !== null ? " e " : ""}${rule.amount_max !== null ? `≤ ${formatCurrency(rule.amount_max)}` : ""}`
                        : ""}
                    </TD>
                    <TD className="text-[12.5px]">
                      {nameOf(lookups.categories, rule.category_id) ?? "Categoria inativa"}
                      {rule.counterparty_id ? <span className="block text-subtle">{nameOf(lookups.counterparties, rule.counterparty_id)}</span> : null}
                    </TD>
                    <TD numeric className="text-muted" title={rule.last_applied_at ? `Último uso: ${formatDateTime(rule.last_applied_at)}` : undefined}>
                      {rule.times_applied}
                    </TD>
                    <TD>
                      {canWrite ? (
                        <Button size="icon" variant="ghost" aria-label={`Editar ${rule.name}`} onClick={() => setEditing(rule)}>
                          <Pencil />
                        </Button>
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </div>
      {editing ? <RuleDialog rule={editing === "new" ? null : editing} lookups={lookups} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}

function RuleDialog({ rule, lookups, onClose }: { rule: FinRuleRow | null; lookups: FinLookups; onClose: () => void }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [name, setName] = React.useState(rule?.name ?? "");
  const [direction, setDirection] = React.useState<FinRuleDirection>(rule?.match_direction ?? "expense");
  const [mode, setMode] = React.useState<FinRuleMatchMode>(rule?.match_mode ?? "contains");
  const [text, setText] = React.useState(rule?.match_text ?? "");
  const [accountId, setAccountId] = React.useState(rule?.match_account_id ?? "");
  const [amountMin, setAmountMin] = React.useState<number | null>(rule?.amount_min ?? null);
  const [amountMax, setAmountMax] = React.useState<number | null>(rule?.amount_max ?? null);
  const [categoryId, setCategoryId] = React.useState(rule?.category_id ?? "");
  const [counterpartyId, setCounterpartyId] = React.useState(rule?.counterparty_id ?? "");
  const [costCenterId, setCostCenterId] = React.useState(rule?.cost_center_id ?? "");
  const [template, setTemplate] = React.useState(rule?.description_template ?? "");
  const [priority, setPriority] = React.useState(rule?.priority ?? 100);
  const [active, setActive] = React.useState(rule?.is_active ?? true);

  async function submit() {
    setPending(true);
    const result = await saveFinRule(
      {
        name,
        isActive: active,
        priority,
        matchDirection: direction,
        matchMode: mode,
        matchText: text,
        matchAccountId: accountId,
        amountMin,
        amountMax,
        categoryId,
        counterpartyId,
        costCenterId,
        descriptionTemplate: template || null,
      },
      rule?.id,
    );
    setPending(false);
    if (result.status === "error") {
      toast.error(result.message);
      return;
    }
    toast.success("Regra salva.");
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{rule ? "Editar regra" : "Nova regra de categorização"}</DialogTitle>
          <DialogDescription>A comparação ignora acentos e maiúsculas. Com várias regras aplicáveis, vale a de menor ordem.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Nome da regra" htmlFor="rule-name" required className="sm:col-span-2">
            <Input id="rule-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Tarifas do Itaú" />
          </FormField>
          <div className="sm:col-span-2">
            <Segmented
              ariaLabel="Direção"
              options={[
                { value: "expense", label: "Saídas" },
                { value: "income", label: "Entradas" },
                { value: "any", label: "Ambas" },
              ]}
              value={direction}
              onChange={setDirection}
            />
          </div>
          <FormField label="Descrição" htmlFor="rule-mode">
            <NativeSelect id="rule-mode" value={mode} onChange={(event) => setMode(event.target.value as FinRuleMatchMode)}>
              <option value="contains">contém</option>
              <option value="starts_with">começa com</option>
              <option value="equals">é exatamente</option>
            </NativeSelect>
          </FormField>
          <FormField label="Texto" htmlFor="rule-text" required>
            <Input id="rule-text" value={text} onChange={(event) => setText(event.target.value)} placeholder="TARIFA" />
          </FormField>
          <FormField label="Só nesta conta" htmlFor="rule-account">
            <NativeSelect id="rule-account" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              <option value="">Qualquer conta</option>
              {lookups.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <div className="grid grid-cols-2 gap-2">
            <FormField label="Valor mínimo" htmlFor="rule-min">
              <MoneyInput id="rule-min" value={amountMin} onChange={setAmountMin} placeholder="—" />
            </FormField>
            <FormField label="Valor máximo" htmlFor="rule-max">
              <MoneyInput id="rule-max" value={amountMax} onChange={setAmountMax} placeholder="—" />
            </FormField>
          </div>
          <FormField label="Categoria aplicada" htmlFor="rule-category" required className="sm:col-span-2">
            <NativeSelect id="rule-category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              {direction === "any" ? (
                <>
                  <CategoryOptions categories={lookups.categories} kind="expense" />
                  <CategoryOptions categories={lookups.categories} kind="income" />
                </>
              ) : (
                <CategoryOptions categories={lookups.categories} kind={direction} />
              )}
            </NativeSelect>
          </FormField>
          <FormField label="Favorecido" htmlFor="rule-counterparty">
            <NativeSelect id="rule-counterparty" value={counterpartyId} onChange={(event) => setCounterpartyId(event.target.value)}>
              <option value="">Não definir</option>
              {lookups.counterparties.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Centro de custo" htmlFor="rule-cost-center">
            <NativeSelect id="rule-cost-center" value={costCenterId} onChange={(event) => setCostCenterId(event.target.value)}>
              <option value="">Não definir</option>
              {lookups.costCenters.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Descrição do lançamento criado" htmlFor="rule-template" hint="Vazio = usa a descrição do banco.">
            <Input id="rule-template" value={template} onChange={(event) => setTemplate(event.target.value)} />
          </FormField>
          <FormField label="Ordem" htmlFor="rule-priority" hint="Menor número tem preferência.">
            <Input id="rule-priority" type="number" min={0} max={9999} value={priority} onChange={(event) => setPriority(Number(event.target.value) || 0)} />
          </FormField>
          <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
            <Checkbox checked={active} onChange={(event) => setActive(event.target.checked)} />
            Regra ativa
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending || !name.trim() || text.trim().length < 2 || !categoryId}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Salvar regra
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Recorrências
// -----------------------------------------------------------------------------
export function RecurrencesSection({
  recurrences,
  upcoming,
  lookups,
  canWrite,
}: {
  recurrences: FinRecurrenceRow[];
  upcoming: { recurrence_id: string; competence_date: string }[];
  lookups: FinLookups;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<FinRecurrenceRow | "new" | null>(null);
  const [generating, setGenerating] = React.useState(false);

  async function generate() {
    setGenerating(true);
    const result = await generateRecurrenceForecasts(90);
    setGenerating(false);
    if (result.status === "error") {
      toast.error(result.message);
      return;
    }
    toast.success(result.data.count ? `${result.data.count} previsão(ões) nova(s) gerada(s).` : "As previsões já estavam em dia.");
    router.refresh();
  }

  const nextOf = (id: string) => upcoming.find((row) => row.recurrence_id === id)?.competence_date ?? null;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold">Recorrências</h2>
          <p className="max-w-2xl text-[12.5px] text-muted">
            Aluguel do escritório, salários, assinaturas, honorários fixos. Geramos as ocorrências dos próximos 90 dias como{" "}
            <strong>previsões</strong> — elas entram no fluxo de caixa previsto, mas só viram despesa ou receita quando você
            confirma ou baixa.
          </p>
        </div>
        {canWrite ? (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={generate} disabled={generating || recurrences.length === 0}>
              {generating ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw />}
              Atualizar previsões
            </Button>
            <Button onClick={() => setEditing("new")}>
              <Plus />
              Nova recorrência
            </Button>
          </div>
        ) : null}
      </div>
      <div className="surface-card overflow-hidden">
        {recurrences.length === 0 ? (
          <EmptyState icon="inbox" title="Nenhuma recorrência." description="Cadastre despesas e receitas que se repetem para enxergar o caixa futuro." />
        ) : (
          <TableWrapper>
            <Table>
              <caption className="sr-only">Recorrências</caption>
              <THead>
                <TR>
                  <TH>Descrição</TH>
                  <TH>Frequência</TH>
                  <TH>Categoria</TH>
                  <TH numeric>Valor</TH>
                  <TH>Próxima</TH>
                  <TH className="w-10">
                    <span className="sr-only">Ações</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {recurrences.map((item) => (
                  <TR key={item.id} className={cn(!item.is_active && "opacity-60")}>
                    <TD>
                      <span className="font-medium">{item.description}</span>
                      <span className="block text-[11.5px] text-subtle">
                        {item.kind === "income" ? "Entrada" : "Saída"} · desde {formatDate(item.start_date)}
                        {item.end_date ? ` até ${formatDate(item.end_date)}` : ""}
                        {!item.is_active ? " · encerrada" : ""}
                      </span>
                    </TD>
                    <TD className="text-muted">
                      {FREQUENCY_LABELS[item.frequency]}
                      <span className="block text-[11px] text-subtle">{item.value_mode === "variable" ? "valor muda" : "valor fixo"}</span>
                    </TD>
                    <TD className="text-muted">{nameOf(lookups.categories, item.category_id) ?? "—"}</TD>
                    <TD numeric className={item.kind === "income" ? "text-info" : undefined}>
                      {formatCurrency(item.amount)}
                    </TD>
                    <TD className="tabular text-muted">
                      {nextOf(item.id) ? (
                        <span className="flex items-center gap-1">
                          <CalendarClock className="size-3.5" />
                          {formatDate(nextOf(item.id))}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD>
                      {canWrite ? (
                        <Button size="icon" variant="ghost" aria-label={`Editar ${item.description}`} onClick={() => setEditing(item)}>
                          <Pencil />
                        </Button>
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </div>
      {editing ? (
        <RecurrenceDialog recurrence={editing === "new" ? null : editing} lookups={lookups} onClose={() => setEditing(null)} />
      ) : null}
    </section>
  );
}

function RecurrenceDialog({
  recurrence,
  lookups,
  onClose,
}: {
  recurrence: FinRecurrenceRow | null;
  lookups: FinLookups;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [kind, setKind] = React.useState<"income" | "expense">(recurrence?.kind ?? "expense");
  const [description, setDescription] = React.useState(recurrence?.description ?? "");
  const [amount, setAmount] = React.useState<number | null>(recurrence?.amount ?? null);
  const [categoryId, setCategoryId] = React.useState(recurrence?.category_id ?? "");
  const [accountId, setAccountId] = React.useState(recurrence?.account_id ?? "");
  const [counterpartyId, setCounterpartyId] = React.useState(recurrence?.counterparty_id ?? "");
  const [costCenterId, setCostCenterId] = React.useState(recurrence?.cost_center_id ?? "");
  const [propertyId, setPropertyId] = React.useState(recurrence?.property_id ?? "");
  const [paymentMethod, setPaymentMethod] = React.useState<string>(recurrence?.payment_method ?? "");
  const [frequency, setFrequency] = React.useState<FinRecurrenceFrequency>(recurrence?.frequency ?? "monthly");
  const [startDate, setStartDate] = React.useState(recurrence?.start_date ?? today());
  const [endDate, setEndDate] = React.useState(recurrence?.end_date ?? "");
  const [active, setActive] = React.useState(recurrence?.is_active ?? true);
  const [notes, setNotes] = React.useState(recurrence?.notes ?? "");
  const [valueMode, setValueMode] = React.useState<"fixed" | "variable">(recurrence?.value_mode ?? "fixed");

  async function submit() {
    if (amount === null) return;
    setPending(true);
    const result = await saveFinRecurrence(
      {
        kind,
        description,
        amount,
        categoryId,
        accountId,
        counterpartyId,
        costCenterId,
        propertyId,
        paymentMethod,
        frequency,
        startDate,
        endDate,
        isActive: active,
        notes,
      },
      recurrence?.id,
    );
    if (result.status === "ok" && valueMode !== (recurrence?.value_mode ?? "fixed")) {
      const modeResult = await setRecurrenceValueMode(result.data.id, valueMode);
      if (modeResult.status === "error") toast.error(modeResult.message);
    }
    setPending(false);
    if (result.status === "error") {
      toast.error(result.message);
      return;
    }
    toast.success(recurrence ? "Recorrência atualizada; previsões futuras refeitas." : "Recorrência criada e previsões geradas.");
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{recurrence ? "Editar recorrência" : "Nova recorrência"}</DialogTitle>
          <DialogDescription>
            {recurrence
              ? "Previsões futuras ainda não pagas serão refeitas com os novos dados. As já pagas não mudam."
              : "As ocorrências dos próximos 90 dias aparecem como previsões em Contas a pagar/receber."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Segmented
              ariaLabel="Tipo"
              options={[
                { value: "expense", label: "Saída" },
                { value: "income", label: "Entrada" },
              ]}
              value={kind}
              onChange={(value) => {
                setKind(value);
                setCategoryId("");
              }}
            />
          </div>
          <FormField label="Descrição" htmlFor="rec-description" required className="sm:col-span-2">
            <Input id="rec-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ex.: Aluguel do escritório" />
          </FormField>
          <FormField label="Valor" htmlFor="rec-amount" required>
            <MoneyInput id="rec-amount" value={amount} onChange={setAmount} />
          </FormField>
          <FormField label="O valor" htmlFor="rec-value-mode" hint={valueMode === "variable" ? "Usamos o último valor pago como estimativa." : undefined}>
            <NativeSelect id="rec-value-mode" value={valueMode} onChange={(event) => setValueMode(event.target.value as "fixed" | "variable")}>
              <option value="fixed">É sempre o mesmo (salário, aluguel)</option>
              <option value="variable">Muda todo mês (luz, água)</option>
            </NativeSelect>
          </FormField>
          <FormField label="Frequência" htmlFor="rec-frequency">
            <NativeSelect id="rec-frequency" value={frequency} onChange={(event) => setFrequency(event.target.value as FinRecurrenceFrequency)}>
              {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Primeira ocorrência" htmlFor="rec-start" required hint="Define também o dia do vencimento.">
            <Input id="rec-start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </FormField>
          <FormField label="Última ocorrência" htmlFor="rec-end" hint="Vazio = sem fim.">
            <Input id="rec-end" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </FormField>
          <FormField label="Categoria" htmlFor="rec-category" required className="sm:col-span-2">
            <NativeSelect id="rec-category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <CategoryOptions categories={lookups.categories} kind={kind} />
            </NativeSelect>
          </FormField>
          <FormField label="Conta prevista" htmlFor="rec-account">
            <NativeSelect id="rec-account" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              <option value="">Definir na baixa</option>
              {lookups.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Forma de pagamento" htmlFor="rec-method">
            <NativeSelect id="rec-method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
              <option value="">Não informar</option>
              {FIN_PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {FIN_PAYMENT_METHOD_LABELS[method]}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Favorecido" htmlFor="rec-counterparty">
            <NativeSelect id="rec-counterparty" value={counterpartyId} onChange={(event) => setCounterpartyId(event.target.value)}>
              <option value="">Nenhum</option>
              {lookups.counterparties.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Centro de custo" htmlFor="rec-cost-center">
            <NativeSelect id="rec-cost-center" value={costCenterId} onChange={(event) => setCostCenterId(event.target.value)}>
              <option value="">Nenhum</option>
              {lookups.costCenters.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          {lookups.properties.length ? (
            <FormField label="Imóvel" htmlFor="rec-property" className="sm:col-span-2">
              <NativeSelect id="rec-property" value={propertyId} onChange={(event) => setPropertyId(event.target.value)}>
                <option value="">Nenhum</option>
                {lookups.properties.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          ) : null}
          <FormField label="Observações" htmlFor="rec-notes" className="sm:col-span-2">
            <Textarea id="rec-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </FormField>
          {recurrence ? (
            <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
              <Checkbox checked={active} onChange={(event) => setActive(event.target.checked)} />
              Ativa (desmarque para encerrar; previsões futuras não pagas são canceladas)
            </label>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending || !description.trim() || !amount || !categoryId || !startDate}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
