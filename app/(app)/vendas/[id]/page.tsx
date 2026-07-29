import type { Metadata } from "next";
import { EntryDetailPage } from "@/features/entries/entry-pages";

export const metadata: Metadata = { title: "Detalhe da venda" };

export default async function VendaDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EntryDetailPage entryType="sale" entryId={id} />;
}
