import type { FinanceRole } from "@/types/database";

/**
 * Permissões do Controle Financeiro. Mesma tabela de `fin_can()` no banco
 * (0010_finance_core.sql) — a interface usa esta para esconder ações; o banco
 * usa a dele para recusar de verdade.
 */
export type FinanceAction = "view" | "write" | "close" | "admin";

const ALLOWED: Record<FinanceAction, FinanceRole[]> = {
  view: ["admin", "financeiro", "gestor", "consulta"],
  write: ["admin", "financeiro"],
  close: ["admin", "financeiro", "gestor"],
  admin: ["admin"],
};

export function financeCan(role: FinanceRole | null | undefined, action: FinanceAction): boolean {
  return role ? ALLOWED[action].includes(role) : false;
}

export const FINANCE_ROLES: FinanceRole[] = ["admin", "financeiro", "gestor", "consulta", "sem_acesso"];
