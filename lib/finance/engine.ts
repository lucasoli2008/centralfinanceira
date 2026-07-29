/**
 * Motor financeiro — fonte única da verdade em TypeScript.
 *
 * As mesmas fórmulas existem em SQL (supabase/migrations/0003_views.sql).
 * Qualquer alteração aqui precisa ser refletida lá e coberta por
 * tests/unit/finance.spec.ts e tests/db/parity.spec.ts.
 *
 * Regras (docs/FINANCIAL_RULES.md):
 *   1. comissão bruta  -> arredondada para 2 casas
 *   2. cada repasse    -> calculado sobre a bruta arredondada, arredondado para 2 casas
 *   3. total de repasses = soma dos repasses JÁ arredondados
 *   4. receita líquida  = bruta − total, arredondada para 2 casas
 *
 * Arredondamento comercial (ROUND_HALF_UP), idêntico ao round(numeric, 2)
 * do PostgreSQL para valores positivos.
 */

import Decimal from "decimal.js";
import type {
  CommissionInput,
  EntryTotals,
  NumericInput,
  SplitInput,
  SplitResult,
} from "./types";

Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export const MONEY_DECIMALS = 2;
export const MARGIN_DECIMALS = 4;

/** Converte qualquer entrada aceita em Decimal, tratando vazio como zero. */
export function toDecimal(value: NumericInput): Decimal {
  if (value === null || value === undefined || value === "") return new Decimal(0);
  try {
    const decimal = new Decimal(value);
    return decimal.isFinite() ? decimal : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}

/** Arredonda para duas casas com arredondamento comercial. */
export function roundMoney(value: NumericInput): number {
  return toDecimal(value).toDecimalPlaces(MONEY_DECIMALS, Decimal.ROUND_HALF_UP).toNumber();
}

export function roundRate(value: NumericInput, decimals = MARGIN_DECIMALS): number {
  return toDecimal(value).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * Comissão bruta da imobiliária.
 *
 *   percentual: valor_base × percentual ÷ 100
 *   fixo:       valor_fixo (substitui completamente o cálculo percentual)
 */
export function calculateGrossCommission(input: CommissionInput): number {
  if (input.mode === "fixed") {
    return roundMoney(input.fixedAmount);
  }
  return roundMoney(toDecimal(input.baseAmount).times(toDecimal(input.rate)).dividedBy(100));
}

/**
 * Repasse de um corretor, sempre calculado sobre a comissão bruta já arredondada.
 */
export function calculateSplitAmount(grossCommission: NumericInput, split: SplitInput): number {
  if (split.mode === "fixed") {
    return roundMoney(split.fixedAmount);
  }
  return roundMoney(toDecimal(grossCommission).times(toDecimal(split.rate)).dividedBy(100));
}

/**
 * Margem líquida em pontos percentuais.
 * Retorna null quando a comissão bruta é zero (sem base para cálculo) —
 * a interface exibe "—" e nunca NaN ou Infinity.
 */
export function calculateNetMargin(
  netRevenue: NumericInput,
  grossCommission: NumericInput,
): number | null {
  const gross = toDecimal(grossCommission);
  if (gross.isZero()) return null;
  return roundRate(toDecimal(netRevenue).dividedBy(gross).times(100));
}

/** Totais completos de um lançamento. */
export function calculateEntryTotals(
  commission: CommissionInput,
  splits: SplitInput[] = [],
): EntryTotals {
  const grossCommission = calculateGrossCommission(commission);

  const resolvedSplits: SplitResult[] = splits.map((split) => ({
    ...split,
    payoutAmount: calculateSplitAmount(grossCommission, split),
  }));

  const totalBrokerPayout = roundMoney(
    resolvedSplits.reduce((total, split) => total.plus(split.payoutAmount), new Decimal(0)),
  );

  const netCompanyRevenue = roundMoney(
    new Decimal(grossCommission).minus(totalBrokerPayout),
  );

  return {
    grossCommission,
    splits: resolvedSplits,
    totalBrokerPayout,
    netCompanyRevenue,
    netMargin: calculateNetMargin(netCompanyRevenue, grossCommission),
    brokerCount: resolvedSplits.length,
    isNegativeNet: netCompanyRevenue < 0,
  };
}

/** Variação percentual entre dois períodos; null quando não há base anterior. */
export function calculateVariation(
  current: NumericInput,
  previous: NumericInput,
): number | null {
  const previousValue = toDecimal(previous);
  if (previousValue.isZero()) return null;
  return roundRate(
    toDecimal(current).minus(previousValue).dividedBy(previousValue.abs()).times(100),
    2,
  );
}

/** Divisão segura para indicadores derivados (ticket médio, percentuais médios). */
export function safeRatio(
  numerator: NumericInput,
  denominator: NumericInput,
  { asPercentage = false }: { asPercentage?: boolean } = {},
): number | null {
  const denominatorValue = toDecimal(denominator);
  if (denominatorValue.isZero()) return null;
  const ratio = toDecimal(numerator).dividedBy(denominatorValue);
  return asPercentage ? roundRate(ratio.times(100)) : roundMoney(ratio);
}
