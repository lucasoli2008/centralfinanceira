import type Decimal from "decimal.js";

/**
 * Tipos do domínio financeiro.
 *
 * Os valores internos são enums estáveis em inglês; toda a interface é
 * apresentada em português brasileiro (ver lib/formatting/labels.ts).
 */

export type EntryType = "sale" | "rental";
export type PropertyType = "residential" | "commercial";
export type AmountMode = "percentage" | "fixed";
export type MemberRole = "owner" | "admin";
export type ClosingStatus = "open" | "closed";

/** Entrada numérica aceita pelo motor: número, string normalizada ou Decimal. */
export type NumericInput = number | string | Decimal | null | undefined;

export interface CommissionInput {
  mode: AmountMode;
  /** Valor da venda ou do primeiro aluguel. */
  baseAmount: NumericInput;
  /** Percentual em pontos percentuais (6% => 6). */
  rate?: NumericInput;
  /** Valor fixo da comissão, em reais. */
  fixedAmount?: NumericInput;
}

export interface SplitInput {
  brokerId?: string | null;
  mode: AmountMode;
  /** Percentual da comissão bruta, em pontos percentuais (40% => 40). */
  rate?: NumericInput;
  /** Valor fixo do repasse, em reais. */
  fixedAmount?: NumericInput;
}

export interface SplitResult extends SplitInput {
  /** Valor do repasse já arredondado para duas casas. */
  payoutAmount: number;
}

export interface EntryTotals {
  /** Comissão bruta arredondada para duas casas. */
  grossCommission: number;
  /** Repasses individuais, cada um arredondado para duas casas. */
  splits: SplitResult[];
  /** Soma dos repasses já arredondados. */
  totalBrokerPayout: number;
  /** Comissão bruta − repasses. */
  netCompanyRevenue: number;
  /** Margem líquida em pontos percentuais; null quando não há base de cálculo. */
  netMargin: number | null;
  brokerCount: number;
  /** true quando os repasses superam a comissão bruta (exige exceção confirmada). */
  isNegativeNet: boolean;
}

export interface PeriodSummary {
  totalGrossCommission: number;
  totalBrokerPayout: number;
  totalNetRevenue: number;
  entriesCount: number;
  salesCount: number;
  rentalCount: number;
  salesBaseAmount: number;
  salesGrossCommission: number;
  salesNetRevenue: number;
  rentalBaseAmount: number;
  rentalGrossCommission: number;
  rentalNetRevenue: number;
  averageGrossCommission: number | null;
  netMargin: number | null;
  weightedSaleCommissionRate: number | null;
  averageBrokerPayoutRate: number | null;
}
