import type { Metadata } from "next";
import { FinanceEntriesPage } from "@/features/finance/entries-page";
import type { FinanceSearchParams } from "@/features/finance/filters";

export const metadata: Metadata = { title: "Contas a pagar" };

export default async function APagarPage({ searchParams }: { searchParams: Promise<FinanceSearchParams> }) {
  return <FinanceEntriesPage mode="payables" searchParams={await searchParams} />;
}
