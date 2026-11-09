import type { Metadata } from "next";
import { FinanceEntriesPage } from "@/features/finance/entries-page";
import type { FinanceSearchParams } from "@/features/finance/filters";

export const metadata: Metadata = { title: "Lançamentos" };

export default async function LancamentosPage({ searchParams }: { searchParams: Promise<FinanceSearchParams> }) {
  return <FinanceEntriesPage mode="ledger" searchParams={await searchParams} />;
}
