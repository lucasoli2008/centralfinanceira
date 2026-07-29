import type { Metadata } from "next";
import { EditEntryPage } from "@/features/entries/entry-pages";

export const metadata: Metadata = { title: "Editar venda" };

export default async function EditarVendaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EditEntryPage entryType="sale" entryId={id} />;
}
