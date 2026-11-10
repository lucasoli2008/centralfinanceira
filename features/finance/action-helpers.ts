import "server-only";

import { revalidatePath } from "next/cache";
import { getAppContext } from "@/lib/auth/session";
import { financeCan, type FinanceAction } from "@/lib/finance/permissions";
import { logServerError, toUserMessage } from "@/lib/errors";

export type Failure = { status: "error"; message: string; fieldErrors?: Record<string, string> };

/** Checagem de permissão na borda; o banco checa de novo em cada RPC (fin_require). */
export async function authorizeFinance(action: FinanceAction): Promise<{ organizationId: string } | Failure> {
  const context = await getAppContext();
  if (!context) return { status: "error", message: "Sua sessão expirou. Entre novamente." };
  if (!financeCan(context.financeRole, action)) {
    return { status: "error", message: "Você não tem permissão para esta operação no Controle Financeiro." };
  }
  return { organizationId: context.organization.id };
}

export function isFailure(value: unknown): value is Failure {
  return typeof value === "object" && value !== null && (value as Failure).status === "error";
}

export function invalid(error: { issues: { path: PropertyKey[]; message: string }[] }): Failure {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".");
    if (!fieldErrors[path]) fieldErrors[path] = issue.message;
  }
  return { status: "error", message: error.issues[0]?.message ?? "Revise os valores informados.", fieldErrors };
}

export function dbFailure(context: string, error: unknown): Failure {
  logServerError(context, error);
  return { status: "error", message: toUserMessage(error) };
}

export function revalidateFinance() {
  revalidatePath("/financeiro", "layout");
}

export const blankToNull = (value: string | null | undefined) => (value === "" || value === undefined ? null : value);
