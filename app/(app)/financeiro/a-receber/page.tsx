import type { Metadata } from "next";
import { FinanceEntriesPage } from "@/features/finance/entries-page";
import type { FinanceSearchParams } from "@/features/finance/filters";

export const metadata: Metadata = { title: "Contas a receber" };

export default async function AReceberPage({ searchParams }: { searchParams: Promise<FinanceSearchParams> }) {
  return <FinanceEntriesPage mode="receivables" searchParams={await searchParams} />;
}
