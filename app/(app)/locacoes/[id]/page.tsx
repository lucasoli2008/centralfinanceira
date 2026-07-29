import type { Metadata } from "next";
import { EntryDetailPage } from "@/features/entries/entry-pages";

export const metadata: Metadata = { title: "Detalhe da locação" };

export default async function LocacaoDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EntryDetailPage entryType="rental" entryId={id} />;
}
