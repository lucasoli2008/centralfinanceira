import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { requireFinance } from "@/lib/auth/session";
import { financeCan } from "@/lib/finance/permissions";
import { getFinLookups } from "@/server/queries/finance";
import {
  listFinRecurrences,
  listFinRules,
  listUpcomingRecurrenceForecasts,
} from "@/server/queries/finance-reconciliation";
import { RecurrencesSection, RulesSection } from "@/features/finance/automation-panel";

export const metadata: Metadata = { title: "Automação e regras" };

export default async function AutomationPage() {
  const context = await requireFinance("view");
  const canWrite = financeCan(context.financeRole, "write");
  const [lookups, rules, recurrences, upcoming] = await Promise.all([
    getFinLookups(),
    listFinRules(),
    listFinRecurrences(),
    listUpcomingRecurrenceForecasts(),
  ]);

  return (
    <>
      <PageHeader
        title="Automação e regras"
        description="Regras que sugerem categorias e recorrências que projetam o caixa. Toda automação é sugestão ou previsão — nenhum dinheiro é movido sem sua confirmação."
      />
      <RulesSection rules={rules} lookups={lookups} canWrite={canWrite} />
      <RecurrencesSection recurrences={recurrences} upcoming={upcoming} lookups={lookups} canWrite={canWrite} />
    </>
  );
}
