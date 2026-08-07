import type { Metadata } from "next";
import { NewWorkPage } from "@/features/works/work-pages";

export const metadata: Metadata = { title: "Nova obra" };

export default function ObraNovaPage() {
  return <NewWorkPage />;
}
