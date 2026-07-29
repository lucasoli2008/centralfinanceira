import type { Metadata } from "next";
import { EntriesPage, type EntriesSearchParams } from "@/features/entries/entries-page";

export const metadata: Metadata = { title: "Vendas" };

export default async function VendasPage({
  searchParams,
}: {
  searchParams: Promise<EntriesSearchParams>;
}) {
  return <EntriesPage entryType="sale" searchParams={await searchParams} />;
}
