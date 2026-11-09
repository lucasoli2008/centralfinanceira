"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormField, Input, NativeSelect, Textarea } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { MoneyInput, PercentInput } from "@/components/finance/money-input";
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
import { FIN_PAYMENT_METHODS } from "@/lib/validation/finance";
import { FIN_PAYMENT_METHOD_LABELS } from "@/lib/formatting/labels";
import { registerCommissionReceipt, registerRentalCollection } from "./actions";
import type { FinLookups, PendingCommissionRow } from "@/server/queries/finance";
import type { FinPaymentMethod } from "@/types/database";

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Mesmo arredondamento do banco (fin_money): meio para longe do zero, 2 casas. */
function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function Breakdown({ items }: { items: { label: string; value: number; tone?: "own" | "third" | "cash" }[] }) {
  return (
    <dl className="grid gap-2 rounded-control border border-border bg-surface-sunken p-3 sm:grid-cols-3">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="label-caption">{item.label}</dt>
          <dd
            className={
              item.tone === "own"
                ? "mt-0.5 text-[15px] font-semibold tabular text-positive"
                : item.tone === "third"
                  ? "mt-0.5 text-[15px] font-semibold tabular text-warning"
                  : "mt-0.5 text-[15px] font-semibold tabular"
            }
          >
            {formatCurrency(item.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Recebimento de aluguel: separa taxa (receita) e repasse ao proprietário (obrigação). */
export function RentalCollectionDialog({
  open,
  onOpenChange,
  lookups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lookups: FinLookups;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [propertyId, setPropertyId] = React.useState("");
  const [ownerId, setOwnerId] = React.useState("");
  const [tenantId, setTenantId] = React.useState("");
  const [accountId, setAccountId] = React.useState(lookups.accounts[0]?.id ?? "");
  const [rent, setRent] = React.useState<number | null>(null);
  const [feeMode, setFeeMode] = React.useState<"rate" | "amount">("rate");
  const [rate, setRate] = React.useState<number | null>(10);
  const [feeAmount, setFeeAmount] = React.useState<number | null>(null);
  const [receivedOn, setReceivedOn] = React.useState(today());
  const [dueDate, setDueDate] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [method, setMethod] = React.useState("");
  const [notes, setNotes] = React.useState("");

  function selectProperty(id: string) {
    setPropertyId(id);
    const property = lookups.properties.find((item) => item.id === id);
    if (property?.owner_counterparty_id) setOwnerId(property.owner_counterparty_id);
    if (property?.admin_fee_rate !== null && property?.admin_fee_rate !== undefined) {
      setFeeMode("rate");
      setRate(Number(property.admin_fee_rate));
    }
  }

  const fee = rent ? (feeMode === "rate" ? money((rent * (rate ?? 0)) / 100) : money(feeAmount ?? 0)) : 0;
  const ownerShare = rent ? money(rent - fee) : 0;
  const invalidFee = rent !== null && (fee < 0 || fee > rent);

  async function submit() {
    setPending(true);
    const result = await registerRentalCollection({
      propertyId,
      ownerCounterpartyId: ownerId,
      tenantCounterpartyId: tenantId,
      accountId,
      rentAmount: rent ?? 0,
      feeMode,
      adminFeeRate: feeMode === "rate" ? rate : null,
      adminFeeAmount: feeMode === "amount" ? feeAmount : null,
      receivedOn,
      transferDueDate: dueDate,
      reference: reference || null,
      paymentMethod: (method || "") as FinPaymentMethod | "",
      notes: notes || null,
    });
    setPending(false);
    if (result.status === "error") {
      toast.error(result.message);
      return;
    }
    toast.success("Aluguel registrado: taxa como receita e repasse ao proprietário em aberto.");
    onOpenChange(false);
    router.refresh();
  }

  const owners = lookups.counterparties.filter((item) => item.kind === "owner");
  const others = lookups.counterparties.filter((item) => item.kind !== "owner");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Registrar recebimento de aluguel</DialogTitle>
          <DialogDescription>
            O caixa recebe o valor integral, mas só a taxa de administração é receita da imobiliária. O restante vira
            uma obrigação de repasse ao proprietário.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Imóvel" htmlFor="rent-property" hint="Preenche proprietário e taxa cadastrados.">
            <NativeSelect id="rent-property" value={propertyId} onChange={(event) => selectProperty(event.target.value)}>
              <option value="">Sem imóvel cadastrado</option>
              {lookups.properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.label}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Proprietário (recebe o repasse)" htmlFor="rent-owner" required>
            <NativeSelect id="rent-owner" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
              <option value="">Selecione…</option>
              {owners.length > 0 ? (
                <optgroup label="Proprietários">
                  {owners.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <optgroup label="Outros favorecidos">
                {others.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </optgroup>
            </NativeSelect>
          </FormField>
          <FormField label="Inquilino (pagador)" htmlFor="rent-tenant">
            <NativeSelect id="rent-tenant" value={tenantId} onChange={(event) => setTenantId(event.target.value)}>
              <option value="">Não informado</option>
              {lookups.counterparties.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Referência" htmlFor="rent-reference" hint="Ex.: 03/2026">
            <Input id="rent-reference" value={reference} onChange={(event) => setReference(event.target.value)} />
          </FormField>
          <FormField label="Valor recebido" htmlFor="rent-amount" required>
            <MoneyInput id="rent-amount" value={rent} onChange={setRent} />
          </FormField>
          <FormField label="Taxa de administração" htmlFor="rent-fee" required error={invalidFee ? "A taxa não pode passar do aluguel." : undefined}>
            <div className="flex gap-2">
              <Segmented
                ariaLabel="Forma da taxa"
                options={[
                  { value: "rate", label: "%" },
                  { value: "amount", label: "R$" },
                ]}
                value={feeMode}
                onChange={setFeeMode}
              />
              {feeMode === "rate" ? (
                <PercentInput id="rent-fee" value={rate} onChange={setRate} className="flex-1" />
              ) : (
                <MoneyInput id="rent-fee" value={feeAmount} onChange={setFeeAmount} className="flex-1" />
              )}
            </div>
          </FormField>
          <FormField label="Conta que recebeu" htmlFor="rent-account" required>
            <NativeSelect id="rent-account" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              {lookups.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Recebido em" htmlFor="rent-date" required>
            <Input id="rent-date" type="date" value={receivedOn} onChange={(event) => setReceivedOn(event.target.value)} />
          </FormField>
          <FormField label="Repassar até" htmlFor="rent-due" hint="Vencimento do repasse. Em branco = mesmo dia.">
            <Input id="rent-due" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </FormField>
          <FormField label="Forma de pagamento" htmlFor="rent-method">
            <NativeSelect id="rent-method" value={method} onChange={(event) => setMethod(event.target.value)}>
              <option value="">Não informada</option>
              {FIN_PAYMENT_METHODS.map((value) => (
                <option key={value} value={value}>
                  {FIN_PAYMENT_METHOD_LABELS[value]}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Observações" htmlFor="rent-notes" className="sm:col-span-2">
            <Textarea id="rent-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </FormField>
        </div>

        {rent ? (
          <div className="mt-4">
            <Breakdown
              items={[
                { label: "Entra no caixa", value: rent, tone: "cash" },
                { label: "Receita da imobiliária", value: fee, tone: "own" },
                { label: "A repassar ao proprietário", value: ownerShare, tone: "third" },
              ]}
            />
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending || !rent || !ownerId || !accountId || invalidFee}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Registrar aluguel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Lança no caixa uma comissão já registrada no módulo de comissões. */
export function CommissionReceiptDialog({
  commission,
  lookups,
  onClose,
}: {
  commission: PendingCommissionRow | null;
  lookups: FinLookups;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [accountId, setAccountId] = React.useState(lookups.accounts[0]?.id ?? "");
  const [receivedOn, setReceivedOn] = React.useState(today());
  const [dueDate, setDueDate] = React.useState("");

  async function submit() {
    if (!commission) return;
    setPending(true);
    const result = await registerCommissionReceipt({
      commissionEntryId: commission.entry_id,
      accountId,
      receivedOn,
      brokerDueDate: dueDate,
    });
    setPending(false);
    if (result.status === "error") {
      toast.error(result.message);
      return;
    }
    toast.success("Comissão lançada no caixa. Repasses aos corretores ficaram em aberto.");
    onClose();
    router.refresh();
  }

  return (
    <Dialog open={Boolean(commission)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Lançar comissão no caixa</DialogTitle>
          <DialogDescription>
            {commission?.description} · registrada em {commission ? formatDate(commission.entry_date) : ""}. O valor do
            imóvel ({formatCurrency(commission?.base_amount ?? 0)}) nunca entra como receita — só a comissão.
          </DialogDescription>
        </DialogHeader>

        {commission ? (
          <Breakdown
            items={[
              { label: "Comissão que entra", value: commission.gross_commission, tone: "cash" },
              { label: "Receita da imobiliária", value: commission.net_company_revenue, tone: "own" },
              { label: "A repassar aos corretores", value: commission.total_broker_payout, tone: "third" },
            ]}
          />
        ) : null}

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <FormField label="Conta que recebeu" htmlFor="commission-account" required>
            <NativeSelect id="commission-account" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              {lookups.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Recebida em" htmlFor="commission-date" required>
            <Input id="commission-date" type="date" value={receivedOn} onChange={(event) => setReceivedOn(event.target.value)} />
          </FormField>
          <FormField label="Repassar até" htmlFor="commission-due" hint="Em branco = mesmo dia.">
            <Input id="commission-due" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </FormField>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending || !accountId}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Lançar no caixa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
