"use client";

import { NativeSelect } from "@/components/ui/field";
import { useUpdateSearchParams } from "./finance-filters";

/** Escolha da conta da conciliação (fica na URL: ?conta=). */
export function AccountPicker({ accounts, value }: { accounts: { id: string; name: string }[]; value: string }) {
  const update = useUpdateSearchParams();
  return (
    <NativeSelect
      aria-label="Conta a conciliar"
      value={value}
      onChange={(event) => update({ conta: event.target.value, situacao: null })}
      className="h-9 w-full sm:w-64"
    >
      {accounts.map((account) => (
        <option key={account.id} value={account.id}>
          {account.name}
        </option>
      ))}
    </NativeSelect>
  );
}
