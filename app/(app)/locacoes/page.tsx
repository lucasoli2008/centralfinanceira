import type { Metadata } from "next";
import { EntriesPage, type EntriesSearchParams } from "@/features/entries/entries-page";

export const metadata: Metadata = { title: "Locações" };

export default async function LocacoesPage({
  searchParams,
}: {
  searchParams: Promise<EntriesSearchParams>;
}) {
  return <EntriesPage entryType="rental" searchParams={await searchParams} />;
}
