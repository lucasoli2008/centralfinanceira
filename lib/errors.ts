/**
 * Tradução de erros técnicos para mensagens humanas.
 * Detalhes internos do banco nunca chegam à interface.
 */

export const APP_ERROR_CODES = {
  MONTH_CLOSED: "CF001",
  FINANCIAL_EXCEPTION: "CF002",
  DUPLICATE: "CF003",
  FORBIDDEN: "CF004",
  NOT_FOUND: "CF005",
} as const;

interface PostgrestLikeError {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

const GENERIC_MESSAGE =
  "Não foi possível concluir a operação. Revise os dados informados e tente novamente.";

const CODE_MESSAGES: Record<string, string> = {
  CF001: "Este mês financeiro está fechado. Reabra o mês antes de realizar alterações.",
  CF004: "Você não tem permissão para realizar esta operação.",
  CF005: "Registro não encontrado.",
  "23505": "Já existe um registro com estas informações.",
  "23503": "Este registro está vinculado a outros dados e não pode ser alterado.",
  "42501": "Você não tem permissão para realizar esta operação.",
  PGRST301: "Sua sessão expirou. Entre novamente para continuar.",
};

/**
 * Mensagens vindas do banco com códigos CF002/CF003 já são escritas em
 * português e voltadas ao usuário final — podem ser exibidas diretamente.
 */
export function toUserMessage(error: unknown): string {
  const typed = error as PostgrestLikeError | null;
  if (!typed) return GENERIC_MESSAGE;

  if (typed.code && (typed.code === "CF002" || typed.code === "CF003")) {
    return typed.message?.trim() || GENERIC_MESSAGE;
  }

  if (typed.code && CODE_MESSAGES[typed.code]) {
    return CODE_MESSAGES[typed.code];
  }

  // Mensagens levantadas por RAISE dentro das RPCs chegam com o texto amigável.
  if (typed.message && /^[A-ZÀ-Ú]/.test(typed.message) && typed.message.length < 220) {
    return typed.message;
  }

  return GENERIC_MESSAGE;
}

export function isMonthClosedError(error: unknown): boolean {
  return (error as PostgrestLikeError | null)?.code === APP_ERROR_CODES.MONTH_CLOSED;
}

export function isFinancialExceptionError(error: unknown): boolean {
  return (error as PostgrestLikeError | null)?.code === APP_ERROR_CODES.FINANCIAL_EXCEPTION;
}

export function isDuplicateError(error: unknown): boolean {
  return (error as PostgrestLikeError | null)?.code === APP_ERROR_CODES.DUPLICATE;
}

/** Log técnico separado do log de auditoria; nunca inclui segredos. */
export function logServerError(context: string, error: unknown): void {
  const typed = error as PostgrestLikeError | null;
  console.error(
    JSON.stringify({
      scope: "central-financeira",
      context,
      code: typed?.code ?? null,
      message: typed?.message ?? String(error),
    }),
  );
}
