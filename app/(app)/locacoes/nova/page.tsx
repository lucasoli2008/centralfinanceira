import type { Metadata } from "next";
import { NewEntryPage } from "@/features/entries/entry-pages";

export const metadata: Metadata = { title: "Nova locação" };

export default async function NovaLocacaoPage({
  searchParams,
}: {
  searchParams: Promise<{ duplicar?: string }>;
}) {
  const { duplicar } = await searchParams;
  return <NewEntryPage entryType="rental" duplicateFrom={duplicar} />;
}
