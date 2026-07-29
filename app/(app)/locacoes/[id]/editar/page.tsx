import type { Metadata } from "next";
import { EditEntryPage } from "@/features/entries/entry-pages";

export const metadata: Metadata = { title: "Editar locação" };

export default async function EditarLocacaoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EditEntryPage entryType="rental" entryId={id} />;
}
