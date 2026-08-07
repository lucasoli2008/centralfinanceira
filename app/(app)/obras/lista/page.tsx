import type { Metadata } from "next";
import { WorkListPage, type WorkListSearchParams } from "@/features/works/work-list-page";

export const metadata: Metadata = { title: "Obras" };

export default async function ObrasListaPage({
  searchParams,
}: {
  searchParams: Promise<WorkListSearchParams>;
}) {
  return <WorkListPage searchParams={await searchParams} />;
}
