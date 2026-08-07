import type { Metadata } from "next";
import { EditWorkPage } from "@/features/works/work-pages";

export const metadata: Metadata = { title: "Editar obra" };

export default async function ObraEditarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditWorkPage workId={id} />;
}
