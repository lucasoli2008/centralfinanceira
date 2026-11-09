"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { EntryDetailSheet, type FinAttachmentWithUrl } from "./entry-detail-sheet";
import type { FinEntryDetail, FinLookups } from "@/server/queries/finance";

/** Abre o detalhe a partir de `?lancamento=` e fecha removendo só esse parâmetro. */
export function EntryDetailHost({
  detail,
  attachments,
  lookups,
  canWrite,
}: {
  detail: FinEntryDetail;
  attachments: FinAttachmentWithUrl[];
  lookups: FinLookups;
  canWrite: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function close() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("lancamento");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <EntryDetailSheet
      key={detail.entry.id}
      detail={detail}
      attachments={attachments}
      lookups={lookups}
      canWrite={canWrite}
      onClose={close}
    />
  );
}
