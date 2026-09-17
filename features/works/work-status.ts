import type { WorkRow } from "@/types/database";

/** Previsão de conclusão vencida e obra ainda aberta. Mesma regra de `getWorkSummary` (servidor). */
export function isWorkOverdue(
  work: Pick<WorkRow, "status" | "expected_at">,
  today = new Date().toISOString().slice(0, 10),
): boolean {
  return (
    Boolean(work.expected_at) &&
    (work.expected_at as string) < today &&
    work.status !== "concluida" &&
    work.status !== "cancelada"
  );
}
