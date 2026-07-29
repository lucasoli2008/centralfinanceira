import type { Metadata } from "next";
import { requireAppContext } from "@/lib/auth/session";
import { FinancialSettingsForm } from "@/features/settings/settings-forms";

export const metadata: Metadata = { title: "Relatórios" };

export default async function ConfiguracoesRelatoriosPage() {
  const context = await requireAppContext();

  return (
    <FinancialSettingsForm
      settings={context.settings}
      disabled={!context.isOwner}
      scope="relatorios"
    />
  );
}
