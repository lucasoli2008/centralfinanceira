import type { Metadata } from "next";
import { NewWorkPage } from "@/features/works/work-pages";

export const metadata: Metadata = { title: "Nova obra" };

export default async function ObraNovaPage({
  searchParams,
}: {
  searchParams: Promise<{ duplicar?: string }>;
}) {
  const { duplicar } = await searchParams;
  return <NewWorkPage duplicateFrom={duplicar} />;
}
