"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/** Atalho de volta para os meses do ano nas telas de ferramentas do financeiro. */
export function BackToFinance() {
  const pathname = usePathname();
  if (pathname === "/financeiro" || pathname.startsWith("/financeiro/mes/")) return null;
  return (
    <Link
      href="/financeiro"
      className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-3.5" />
      Voltar ao Controle Financeiro
    </Link>
  );
}
