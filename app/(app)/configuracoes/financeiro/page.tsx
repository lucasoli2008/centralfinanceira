import type { Metadata } from "next";
import { requireAppContext } from "@/lib/auth/session";
import { FinancialSettingsForm } from "@/features/settings/settings-forms";

export const metadata: Metadata = { title: "Padrões financeiros" };

export default async function ConfiguracoesFinanceiroPage() {
  const context = await requireAppContext();

  return (
    <FinancialSettingsForm
      settings={context.settings}
      disabled={!context.isOwner}
      scope="financeiro"
    />
  );
}
