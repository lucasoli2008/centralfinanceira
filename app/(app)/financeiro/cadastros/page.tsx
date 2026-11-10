import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { requireFinance } from "@/lib/auth/session";
import { financeCan } from "@/lib/finance/permissions";
import { cn } from "@/lib/utils";
import { listBrokers } from "@/server/queries/brokers";
import {
  getFinAccountBalances,
  listFinAccounts,
  listFinCategories,
  listFinCostCenters,
  listFinCounterparties,
  listFinProperties,
} from "@/server/queries/finance";
import {
  AccountsSection,
  CategoriesSection,
  CostCentersSection,
  CounterpartiesSection,
  PropertiesSection,
} from "@/features/finance/registry";

export const metadata: Metadata = { title: "Cadastros financeiros" };

const TABS = [
  { key: "contas", label: "Contas" },
  { key: "categorias", label: "Plano de categorias" },
  { key: "favorecidos", label: "Favorecidos" },
  { key: "imoveis", label: "Imóveis administrados" },
  { key: "centros", label: "Centros de custo" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function FinanceRegistryPage({ searchParams }: { searchParams: Promise<{ aba?: string; novo?: string }> }) {
  const context = await requireFinance("view");
  const canWrite = financeCan(context.financeRole, "write");
  const params = await searchParams;
  const tab: TabKey = TABS.some((item) => item.key === params.aba) ? (params.aba as TabKey) : "contas";

  return (
    <>
      <PageHeader
        title="Configurações do financeiro"
        description="Contas, categorias, favorecidos, imóveis, centros de custo, regras e recorrências."
      />
      <nav aria-label="Seções de cadastro" className="mb-5 flex flex-wrap gap-1 border-b border-border">
        {TABS.map((item) => (
          <Link
            key={item.key}
            href={`/financeiro/cadastros?aba=${item.key}`}
            aria-current={tab === item.key ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[13px] transition-colors",
              tab === item.key ? "border-foreground font-medium text-foreground" : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        ))}
        <Link
          href="/financeiro/automacao"
          className="-mb-px border-b-2 border-transparent px-3 py-2 text-[13px] text-muted transition-colors hover:text-foreground"
        >
          Regras e recorrências
        </Link>
      </nav>
      <TabContent tab={tab} canWrite={canWrite} />
    </>
  );
}

async function TabContent({ tab, canWrite }: { tab: TabKey; canWrite: boolean }) {
  switch (tab) {
    case "contas": {
      const [accounts, balances] = await Promise.all([listFinAccounts(), getFinAccountBalances()]);
      return <AccountsSection accounts={accounts} balances={balances} canWrite={canWrite} />;
    }
    case "categorias":
      return <CategoriesSection categories={await listFinCategories()} canWrite={canWrite} />;
    case "favorecidos": {
      const [counterparties, brokers] = await Promise.all([listFinCounterparties(), listBrokers()]);
      return (
        <CounterpartiesSection
          counterparties={counterparties}
          brokers={brokers.map((broker) => ({ id: broker.id, full_name: broker.full_name }))}
          canWrite={canWrite}
        />
      );
    }
    case "imoveis": {
      const [properties, counterparties] = await Promise.all([listFinProperties(), listFinCounterparties(false)]);
      return <PropertiesSection properties={properties} counterparties={counterparties} canWrite={canWrite} />;
    }
    case "centros":
      return <CostCentersSection costCenters={await listFinCostCenters()} canWrite={canWrite} />;
  }
}
