/**
 * Formato padrão de retorno das Server Actions do projeto.
 */
export type ActionResult<T = void> =
  | ({ status: "ok" } & (T extends void ? object : { data: T }))
  | { status: "error"; message: string; fieldErrors?: Record<string, string> };
