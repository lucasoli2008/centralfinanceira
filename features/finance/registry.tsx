"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Lock, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout, Checkbox, FormField, Input, NativeSelect, Textarea } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/states";
import { Table, TableWrapper, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { MoneyInput, PercentInput } from "@/components/finance/money-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrency, formatPercent } from "@/lib/formatting/number";
import { formatDate } from "@/lib/formatting/date";
import {
  FIN_ACCOUNT_KIND_LABELS,
  FIN_COUNTERPARTY_KIND_LABELS,
  FIN_NATURE_HINTS,
  FIN_NATURE_LABELS,
} from "@/lib/formatting/labels";
import { FIN_ACCOUNT_KINDS, FIN_COUNTERPARTY_KINDS, FIN_NATURES } from "@/lib/validation/finance";
import { cn } from "@/lib/utils";
import {
  saveFinAccount,
  saveFinCategory,
  saveFinCostCenter,
  saveFinCounterparty,
  saveFinProperty,
} from "./actions";
import type {
  FinAccountBalanceRow,
  FinAccountKind,
  FinAccountRow,
  FinCategoryRow,
  FinCostCenterRow,
  FinCounterpartyKind,
  FinCounterpartyRow,
  FinNature,
  FinPropertyRow,
} from "@/types/database";
import type { ActionResult } from "@/lib/action-result";

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Envio comum: toast de erro ou sucesso e atualização da página. */
function useSubmit() {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const submit = React.useCallback(
    async (run: () => Promise<ActionResult<{ id: string }>>, success: string, onDone: () => void) => {
      setPending(true);
      const result = await run();
      setPending(false);
      if (result.status === "error") {
        toast.error(result.message);
        return;
      }
      toast.success(success);
      onDone();
      router.refresh();
    },
    [router],
  );
  return { pending, submit };
}

function SectionToolbar({ count, label, onNew, canWrite }: { count: number; label: string; onNew: () => void; canWrite: boolean }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <p className="text-[12.5px] text-muted">{count} cadastrado(s)</p>
      {canWrite ? (
        <Button onClick={onNew}>
          <Plus />
          {label}
        </Button>
      ) : null}
    </div>
  );
}

function ActiveBadge({ active }: { active: boolean }) {
  return active ? <Badge tone="positive">Ativo</Badge> : <Badge tone="neutral">Inativo</Badge>;
}

// -----------------------------------------------------------------------------
// Contas
// -----------------------------------------------------------------------------

export function AccountsSection({
  accounts,
  balances,
  canWrite,
}: {
  accounts: FinAccountRow[];
  balances: FinAccountBalanceRow[];
  canWrite: boolean;
}) {
  const searchParams = useSearchParams();
  const [editing, setEditing] = React.useState<FinAccountRow | "new" | null>(
    searchParams.get("novo") === "1" && canWrite ? "new" : null,
  );
  const balanceOf = (id: string) => balances.find((row) => row.account_id === id)?.balance ?? 0;

  return (
    <>
      <SectionToolbar count={accounts.length} label="Nova conta" onNew={() => setEditing("new")} canWrite={canWrite} />
      <div className="surface-card overflow-hidden">
        {accounts.length === 0 ? (
          <EmptyState
            title="Nenhuma conta cadastrada."
            description="Cadastre conta corrente, poupança, caixa físico e contas digitais. O saldo inicial é registrado no livro-razão."
          />
        ) : (
          <TableWrapper>
            <Table>
              <caption className="sr-only">Contas financeiras</caption>
              <THead>
                <TR>
                  <TH>Conta</TH>
                  <TH>Tipo</TH>
                  <TH>Banco</TH>
                  <TH>Saldo inicial</TH>
                  <TH numeric>Saldo atual</TH>
                  <TH>Situação</TH>
                  <TH className="w-10">
                    <span className="sr-only">Ações</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {accounts.map((account) => (
                  <TR key={account.id}>
                    <TD className="font-medium">{account.name}</TD>
                    <TD className="text-muted">{FIN_ACCOUNT_KIND_LABELS[account.kind]}</TD>
                    <TD className="text-muted">
                      {account.bank_name ?? "—"}
                      {account.account_number ? <span className="block text-[11.5px] text-subtle">Conta final {account.account_number.slice(-4)}</span> : null}
                    </TD>
                    <TD className="text-muted tabular">
                      {formatCurrency(account.opening_balance)} em {formatDate(account.opening_date)}
                    </TD>
                    <TD numeric className={cn("font-semibold", balanceOf(account.id) < 0 && "text-danger")}>
                      {formatCurrency(balanceOf(account.id))}
                    </TD>
                    <TD>
                      <ActiveBadge active={account.is_active} />
                    </TD>
                    <TD>
                      {canWrite ? (
                        <Button variant="ghost" size="icon" aria-label={`Editar ${account.name}`} onClick={() => setEditing(account)}>
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
        <AccountDialog account={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}

function AccountDialog({ account, onClose }: { account: FinAccountRow | null; onClose: () => void }) {
  const { pending, submit } = useSubmit();
  const [name, setName] = React.useState(account?.name ?? "");
  const [kind, setKind] = React.useState<FinAccountKind>(account?.kind ?? "checking");
  const [bankName, setBankName] = React.useState(account?.bank_name ?? "");
  const [branch, setBranch] = React.useState(account?.branch ?? "");
  const [accountNumber, setAccountNumber] = React.useState(account?.account_number ?? "");
  const [opening, setOpening] = React.useState<number | null>(account?.opening_balance ?? 0);
  const [openingDate, setOpeningDate] = React.useState(account?.opening_date ?? today());
  const [active, setActive] = React.useState(account?.is_active ?? true);
  const [notes, setNotes] = React.useState(account?.notes ?? "");

  const openingChanged = account && (account.opening_balance !== (opening ?? 0) || account.opening_date !== openingDate);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{account ? "Editar conta" : "Nova conta financeira"}</DialogTitle>
          <DialogDescription>Informe o saldo da conta em uma data de referência. Movimentos posteriores são somados a partir dele.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Nome" htmlFor="account-name" required className="sm:col-span-2">
            <Input id="account-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Itaú conta corrente" />
          </FormField>
          <FormField label="Tipo" htmlFor="account-kind">
            <NativeSelect id="account-kind" value={kind} onChange={(event) => setKind(event.target.value as FinAccountKind)}>
              {FIN_ACCOUNT_KINDS.map((value) => (
                <option key={value} value={value}>
                  {FIN_ACCOUNT_KIND_LABELS[value]}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Banco" htmlFor="account-bank">
            <Input id="account-bank" value={bankName} onChange={(event) => setBankName(event.target.value)} />
          </FormField>
          <FormField label="Agência" htmlFor="account-branch">
            <Input id="account-branch" value={branch} onChange={(event) => setBranch(event.target.value)} />
          </FormField>
          <FormField label="Número da conta" htmlFor="account-number" hint="Exibimos só os 4 últimos dígitos nas listas.">
            <Input id="account-number" value={accountNumber} onChange={(event) => setAccountNumber(event.target.value)} />
          </FormField>
          <FormField label="Saldo inicial" htmlFor="account-opening" required>
            <MoneyInput id="account-opening" value={opening} onChange={setOpening} />
          </FormField>
          <FormField label="Data do saldo inicial" htmlFor="account-opening-date" required>
            <Input id="account-opening-date" type="date" value={openingDate} onChange={(event) => setOpeningDate(event.target.value)} />
          </FormField>
          <FormField label="Observações" htmlFor="account-notes" className="sm:col-span-2">
            <Textarea id="account-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </FormField>
          <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
            <Checkbox checked={active} onChange={(event) => setActive(event.target.checked)} />
            Conta ativa (contas inativas continuam nos relatórios, mas não aparecem nos formulários)
          </label>
        </div>
        {openingChanged ? (
          <Callout tone="warning" className="mt-3">
            Alterar o saldo inicial estorna o lançamento de abertura anterior e cria um novo — o histórico fica registrado.
          </Callout>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={pending || !name.trim()}
            onClick={() =>
              submit(
                () =>
                  saveFinAccount(
                    {
                      name,
                      kind,
                      bankName: bankName || null,
                      branch: branch || null,
                      accountNumber: accountNumber || null,
                      openingBalance: opening ?? 0,
                      openingDate,
                      isActive: active,
                      notes: notes || null,
                    },
                    account?.id,
                  ),
                account ? "Conta atualizada." : "Conta cadastrada.",
                onClose,
              )
            }
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Salvar conta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Categorias
// -----------------------------------------------------------------------------

type CategoryEdit = { mode: "new-group" } | { mode: "new-child"; group: FinCategoryRow } | { mode: "edit"; category: FinCategoryRow };

export function CategoriesSection({ categories, canWrite }: { categories: FinCategoryRow[]; canWrite: boolean }) {
  const [editing, setEditing] = React.useState<CategoryEdit | null>(null);
  const groups = categories.filter((category) => !category.parent_id);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-[12.5px] text-muted">
          A natureza de cada grupo define o efeito contábil: receitas e despesas entram no resultado; valores de terceiros,
          cauções e movimentos de sócios nunca entram.
        </p>
        {canWrite ? (
          <Button variant="secondary" onClick={() => setEditing({ mode: "new-group" })}>
            <Plus />
            Novo grupo
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((group) => {
          const children = categories.filter((category) => category.parent_id === group.id);
          return (
            <section key={group.id} className={cn("surface-card", !group.is_active && "opacity-60")}>
              <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
                <div>
                  <p className="flex items-center gap-2 text-[13.5px] font-semibold">
                    {group.name}
                    {group.system_key ? <Lock className="size-3 text-subtle" aria-label="Grupo do sistema" /> : null}
                  </p>
                  <p className="text-[11.5px] text-subtle">
                    {FIN_NATURE_LABELS[group.nature]} · {FIN_NATURE_HINTS[group.nature]}
                  </p>
                </div>
                {canWrite ? (
                  <div className="flex shrink-0 gap-1">
                    <Button size="icon" variant="ghost" aria-label={`Editar ${group.name}`} onClick={() => setEditing({ mode: "edit", category: group })}>
                      <Pencil />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ mode: "new-child", group })}>
                      <Plus />
                      Subcategoria
                    </Button>
                  </div>
                ) : null}
              </header>
              <ul className="divide-y divide-border">
                {children.length === 0 ? <li className="px-4 py-2.5 text-[12.5px] text-subtle">Sem subcategorias.</li> : null}
                {children.map((category) => (
                  <li key={category.id} className={cn("flex items-center justify-between gap-2 px-4 py-2 text-[13px]", !category.is_active && "text-subtle")}>
                    <span className="flex items-center gap-2">
                      {category.name}
                      {category.system_key ? (
                        <Badge tone="neutral" title="Usada pelas operações automáticas">
                          Sistema
                        </Badge>
                      ) : null}
                      {category.cost_behavior ? (
                        <span className="text-[11px] text-subtle">{category.cost_behavior === "fixed" ? "fixa" : "variável"}</span>
                      ) : null}
                      {!category.is_active ? <Badge tone="neutral">Inativa</Badge> : null}
                    </span>
                    {canWrite ? (
                      <Button size="icon" variant="ghost" aria-label={`Editar ${category.name}`} onClick={() => setEditing({ mode: "edit", category })}>
                        <Pencil />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {editing ? <CategoryDialog edit={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function CategoryDialog({ edit, onClose }: { edit: CategoryEdit; onClose: () => void }) {
  const { pending, submit } = useSubmit();
  const current = edit.mode === "edit" ? edit.category : null;
  const parent = edit.mode === "new-child" ? edit.group : null;
  const isGroup = edit.mode === "new-group" || (current !== null && !current.parent_id);
  const [name, setName] = React.useState(current?.name ?? "");
  const [nature, setNature] = React.useState<FinNature>(current?.nature ?? parent?.nature ?? "operating_expense");
  const [costBehavior, setCostBehavior] = React.useState<string>(current?.cost_behavior ?? "");
  const [active, setActive] = React.useState(current?.is_active ?? true);
  const showsCost = ["deduction", "direct_cost", "operating_expense", "other_expense"].includes(nature);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {edit.mode === "new-group" ? "Novo grupo de categorias" : edit.mode === "new-child" ? `Nova subcategoria em ${parent?.name}` : "Editar categoria"}
          </DialogTitle>
          <DialogDescription>
            {isGroup ? "O grupo define a natureza contábil de todas as suas subcategorias." : "Subcategorias herdam a natureza do grupo."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormField label="Nome" htmlFor="category-name" required>
            <Input id="category-name" value={name} onChange={(event) => setName(event.target.value)} />
          </FormField>
          {isGroup ? (
            <FormField label="Natureza" htmlFor="category-nature" required hint={FIN_NATURE_HINTS[nature]}>
              <NativeSelect id="category-nature" value={nature} onChange={(event) => setNature(event.target.value as FinNature)}>
                {FIN_NATURES.map((value) => (
                  <option key={value} value={value}>
                    {FIN_NATURE_LABELS[value]}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          ) : null}
          {showsCost ? (
            <FormField label="Comportamento do custo" htmlFor="category-cost" hint="Usado na análise de custos fixos e variáveis.">
              <NativeSelect id="category-cost" value={costBehavior} onChange={(event) => setCostBehavior(event.target.value)}>
                <option value="">Não classificar</option>
                <option value="fixed">Fixo</option>
                <option value="variable">Variável</option>
              </NativeSelect>
            </FormField>
          ) : null}
          {current && !current.system_key ? (
            <label className="flex items-center gap-2 text-[13px]">
              <Checkbox checked={active} onChange={(event) => setActive(event.target.checked)} />
              Ativa
            </label>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={pending || !name.trim()}
            onClick={() =>
              submit(
                () =>
                  saveFinCategory(
                    {
                      name,
                      parentId: current ? current.parent_id : parent?.id ?? null,
                      nature: parent?.nature ?? nature,
                      costBehavior: showsCost ? (costBehavior as "fixed" | "variable" | "") : "",
                      isActive: active,
                    },
                    current?.id,
                  ),
                "Categoria salva.",
                onClose,
              )
            }
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Favorecidos
// -----------------------------------------------------------------------------

export function CounterpartiesSection({
  counterparties,
  brokers,
  canWrite,
}: {
  counterparties: FinCounterpartyRow[];
  brokers: { id: string; full_name: string }[];
  canWrite: boolean;
}) {
  const [editing, setEditing] = React.useState<FinCounterpartyRow | "new" | null>(null);
  return (
    <>
      <SectionToolbar count={counterparties.length} label="Novo favorecido" onNew={() => setEditing("new")} canWrite={canWrite} />
      <div className="surface-card overflow-hidden">
        {counterparties.length === 0 ? (
          <EmptyState
            title="Nenhum favorecido cadastrado."
            description="Fornecedores, proprietários, inquilinos e corretores. Corretores são criados automaticamente quando uma comissão entra no caixa."
          />
        ) : (
          <TableWrapper>
            <Table>
              <caption className="sr-only">Favorecidos e pagadores</caption>
              <THead>
                <TR>
                  <TH>Nome</TH>
                  <TH>Tipo</TH>
                  <TH>Documento</TH>
                  <TH>Contato</TH>
                  <TH>Situação</TH>
                  <TH className="w-10">
                    <span className="sr-only">Ações</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {counterparties.map((item) => (
                  <TR key={item.id}>
                    <TD className="font-medium">{item.name}</TD>
                    <TD className="text-muted">{FIN_COUNTERPARTY_KIND_LABELS[item.kind]}</TD>
                    <TD className="text-muted">{item.document_number ?? "—"}</TD>
                    <TD className="text-muted">{[item.email, item.phone].filter(Boolean).join(" · ") || "—"}</TD>
                    <TD>
                      <ActiveBadge active={item.is_active} />
                    </TD>
                    <TD>
                      {canWrite ? (
                        <Button variant="ghost" size="icon" aria-label={`Editar ${item.name}`} onClick={() => setEditing(item)}>
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
        <CounterpartyDialog counterparty={editing === "new" ? null : editing} brokers={brokers} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}

function CounterpartyDialog({
  counterparty,
  brokers,
  onClose,
}: {
  counterparty: FinCounterpartyRow | null;
  brokers: { id: string; full_name: string }[];
  onClose: () => void;
}) {
  const { pending, submit } = useSubmit();
  const [name, setName] = React.useState(counterparty?.name ?? "");
  const [kind, setKind] = React.useState<FinCounterpartyKind>(counterparty?.kind ?? "supplier");
  const [document, setDocument] = React.useState(counterparty?.document_number ?? "");
  const [email, setEmail] = React.useState(counterparty?.email ?? "");
  const [phone, setPhone] = React.useState(counterparty?.phone ?? "");
  const [brokerId, setBrokerId] = React.useState(counterparty?.broker_id ?? "");
  const [notes, setNotes] = React.useState(counterparty?.notes ?? "");
  const [active, setActive] = React.useState(counterparty?.is_active ?? true);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{counterparty ? "Editar favorecido" : "Novo favorecido"}</DialogTitle>
          <DialogDescription>Quem paga ou recebe nos lançamentos. Guarde apenas os dados necessários (LGPD).</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Nome" htmlFor="cp-name" required className="sm:col-span-2">
            <Input id="cp-name" value={name} onChange={(event) => setName(event.target.value)} />
          </FormField>
          <FormField label="Tipo" htmlFor="cp-kind">
            <NativeSelect id="cp-kind" value={kind} onChange={(event) => setKind(event.target.value as FinCounterpartyKind)}>
              {FIN_COUNTERPARTY_KINDS.map((value) => (
                <option key={value} value={value}>
                  {FIN_COUNTERPARTY_KIND_LABELS[value]}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="CPF / CNPJ" htmlFor="cp-document">
            <Input id="cp-document" value={document} onChange={(event) => setDocument(event.target.value)} />
          </FormField>
          <FormField label="E-mail" htmlFor="cp-email">
            <Input id="cp-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </FormField>
          <FormField label="Telefone" htmlFor="cp-phone">
            <Input id="cp-phone" value={phone} onChange={(event) => setPhone(event.target.value)} />
          </FormField>
          {kind === "broker" ? (
            <FormField label="Corretor vinculado" htmlFor="cp-broker" className="sm:col-span-2" hint="Liga os repasses de comissão a este favorecido.">
              <NativeSelect id="cp-broker" value={brokerId} onChange={(event) => setBrokerId(event.target.value)}>
                <option value="">Nenhum</option>
                {brokers.map((broker) => (
                  <option key={broker.id} value={broker.id}>
                    {broker.full_name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          ) : null}
          <FormField label="Observações" htmlFor="cp-notes" className="sm:col-span-2">
            <Textarea id="cp-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </FormField>
          {counterparty ? (
            <label className="flex items-center gap-2 text-[13px]">
              <Checkbox checked={active} onChange={(event) => setActive(event.target.checked)} />
              Ativo
            </label>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={pending || !name.trim()}
            onClick={() =>
              submit(
                () =>
                  saveFinCounterparty(
                    {
                      name,
                      kind,
                      documentNumber: document || null,
                      email: email || "",
                      phone: phone || null,
                      brokerId: kind === "broker" ? brokerId : "",
                      notes: notes || null,
                      isActive: active,
                    },
                    counterparty?.id,
                  ),
                "Favorecido salvo.",
                onClose,
              )
            }
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Imóveis
// -----------------------------------------------------------------------------

export function PropertiesSection({
  properties,
  counterparties,
  canWrite,
}: {
  properties: FinPropertyRow[];
  counterparties: FinCounterpartyRow[];
  canWrite: boolean;
}) {
  const [editing, setEditing] = React.useState<FinPropertyRow | "new" | null>(null);
  const ownerName = (id: string | null) => counterparties.find((item) => item.id === id)?.name ?? "—";

  return (
    <>
      <SectionToolbar count={properties.length} label="Novo imóvel" onNew={() => setEditing("new")} canWrite={canWrite} />
      <div className="surface-card overflow-hidden">
        {properties.length === 0 ? (
          <EmptyState
            title="Nenhum imóvel administrado cadastrado."
            description="Cadastre os imóveis cuja locação a imobiliária administra, com o proprietário e a taxa de administração."
          />
        ) : (
          <TableWrapper>
            <Table>
              <caption className="sr-only">Imóveis administrados</caption>
              <THead>
                <TR>
                  <TH>Imóvel</TH>
                  <TH>Proprietário</TH>
                  <TH numeric>Taxa de administração</TH>
                  <TH>Situação</TH>
                  <TH className="w-10">
                    <span className="sr-only">Ações</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {properties.map((property) => (
                  <TR key={property.id}>
                    <TD>
                      <span className="font-medium">{property.label}</span>
                      {property.address ? <span className="block text-[11.5px] text-subtle">{property.address}</span> : null}
                    </TD>
                    <TD className="text-muted">{ownerName(property.owner_counterparty_id)}</TD>
                    <TD numeric>{property.admin_fee_rate === null ? "—" : formatPercent(property.admin_fee_rate)}</TD>
                    <TD>
                      <ActiveBadge active={property.is_active} />
                    </TD>
                    <TD>
                      {canWrite ? (
                        <Button variant="ghost" size="icon" aria-label={`Editar ${property.label}`} onClick={() => setEditing(property)}>
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
        <PropertyDialog property={editing === "new" ? null : editing} counterparties={counterparties} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}

function PropertyDialog({
  property,
  counterparties,
  onClose,
}: {
  property: FinPropertyRow | null;
  counterparties: FinCounterpartyRow[];
  onClose: () => void;
}) {
  const { pending, submit } = useSubmit();
  const [label, setLabel] = React.useState(property?.label ?? "");
  const [address, setAddress] = React.useState(property?.address ?? "");
  const [ownerId, setOwnerId] = React.useState(property?.owner_counterparty_id ?? "");
  const [rate, setRate] = React.useState<number | null>(property?.admin_fee_rate ?? 10);
  const [active, setActive] = React.useState(property?.is_active ?? true);
  const [notes, setNotes] = React.useState(property?.notes ?? "");
  const owners = counterparties.filter((item) => item.kind === "owner");

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{property ? "Editar imóvel" : "Novo imóvel administrado"}</DialogTitle>
          <DialogDescription>Usado para separar aluguel, taxa de administração e repasse ao proprietário.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Identificação" htmlFor="prop-label" required className="sm:col-span-2">
            <Input id="prop-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Ex.: Apto 302 — Ed. Aurora" />
          </FormField>
          <FormField label="Endereço" htmlFor="prop-address" className="sm:col-span-2">
            <Input id="prop-address" value={address} onChange={(event) => setAddress(event.target.value)} />
          </FormField>
          <FormField label="Proprietário" htmlFor="prop-owner" hint={owners.length === 0 ? "Cadastre o proprietário em Favorecidos (tipo Proprietário)." : undefined}>
            <NativeSelect id="prop-owner" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
              <option value="">Não informado</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Taxa de administração" htmlFor="prop-rate">
            <PercentInput id="prop-rate" value={rate} onChange={setRate} />
          </FormField>
          <FormField label="Observações" htmlFor="prop-notes" className="sm:col-span-2">
            <Textarea id="prop-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </FormField>
          {property ? (
            <label className="flex items-center gap-2 text-[13px]">
              <Checkbox checked={active} onChange={(event) => setActive(event.target.checked)} />
              Ativo
            </label>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={pending || !label.trim()}
            onClick={() =>
              submit(
                () =>
                  saveFinProperty(
                    {
                      label,
                      address: address || null,
                      ownerCounterpartyId: ownerId,
                      adminFeeRate: rate,
                      isActive: active,
                      notes: notes || null,
                    },
                    property?.id,
                  ),
                "Imóvel salvo.",
                onClose,
              )
            }
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Centros de custo
// -----------------------------------------------------------------------------

export function CostCentersSection({ costCenters, canWrite }: { costCenters: FinCostCenterRow[]; canWrite: boolean }) {
  const [editing, setEditing] = React.useState<FinCostCenterRow | "new" | null>(null);
  return (
    <>
      <SectionToolbar count={costCenters.length} label="Novo centro de custo" onNew={() => setEditing("new")} canWrite={canWrite} />
      <div className="surface-card overflow-hidden">
        {costCenters.length === 0 ? (
          <EmptyState title="Nenhum centro de custo." description="Opcional. Ex.: Vendas, Locação, Administrativo — para analisar despesas por área." />
        ) : (
          <ul className="divide-y divide-border">
            {costCenters.map((center) => (
              <li key={center.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
                <span className="flex items-center gap-2">
                  {center.name}
                  {!center.is_active ? <Badge tone="neutral">Inativo</Badge> : null}
                </span>
                {canWrite ? (
                  <Button variant="ghost" size="icon" aria-label={`Editar ${center.name}`} onClick={() => setEditing(center)}>
                    <Pencil />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      {editing ? <CostCenterDialog center={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function CostCenterDialog({ center, onClose }: { center: FinCostCenterRow | null; onClose: () => void }) {
  const { pending, submit } = useSubmit();
  const [name, setName] = React.useState(center?.name ?? "");
  const [active, setActive] = React.useState(center?.is_active ?? true);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{center ? "Editar centro de custo" : "Novo centro de custo"}</DialogTitle>
          <DialogDescription>Agrupa despesas por área da imobiliária.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormField label="Nome" htmlFor="cc-name" required>
            <Input id="cc-name" value={name} onChange={(event) => setName(event.target.value)} />
          </FormField>
          {center ? (
            <label className="flex items-center gap-2 text-[13px]">
              <Checkbox checked={active} onChange={(event) => setActive(event.target.checked)} />
              Ativo
            </label>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={pending || !name.trim()}
            onClick={() => submit(() => saveFinCostCenter({ name, isActive: active }, center?.id), "Centro de custo salvo.", onClose)}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
