import type { Metadata } from "next";
import { NewEntryPage } from "@/features/entries/entry-pages";

export const metadata: Metadata = { title: "Nova venda" };

export default async function NovaVendaPage({
  searchParams,
}: {
  searchParams: Promise<{ duplicar?: string }>;
}) {
  const { duplicar } = await searchParams;
  return <NewEntryPage entryType="sale" duplicateFrom={duplicar} />;
}
