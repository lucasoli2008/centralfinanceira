import { resolvePeriod, type PeriodParams, type PeriodRange } from "@/lib/period";
import type { FinNature, FinRegime } from "@/types/database";
import type { FinReportFilters } from "@/server/queries/finance";
import { FIN_NATURES } from "@/lib/validation/finance";

export interface FinanceSearchParams extends PeriodParams {
  regime?: string;
  conta?: string;
  categoria?: string;
  natureza?: string;
  busca?: string;
  status?: string;
  tipo?: string;
  favorecido?: string;
  pagina?: string;
  lancamento?: string;
  operacao?: string;
  novo?: string;
  aba?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validUuid(value: string | undefined): string | null {
  return value && UUID.test(value) ? value : null;
}

/** Traduz a URL nos filtros dos relatórios financeiros. Caixa é o regime padrão. */
export function resolveFinanceFilters(params: FinanceSearchParams): {
  filters: FinReportFilters;
  period: PeriodRange;
} {
  const period = resolvePeriod(params);
  const regime: FinRegime = params.regime === "competencia" ? "competencia" : "caixa";
  const nature = (FIN_NATURES as readonly string[]).includes(params.natureza ?? "")
    ? (params.natureza as FinNature)
    : null;

  return {
    period,
    filters: {
      from: period.from,
      to: period.to,
      regime,
      accountId: validUuid(params.conta),
      categoryId: validUuid(params.categoria),
      nature,
    },
  };
}

export function financeYears(): number[] {
  const current = new Date().getFullYear();
  return [current + 1, current, current - 1, current - 2, current - 3];
}
