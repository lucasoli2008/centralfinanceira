/**
 * Casamento de nome de corretor usado pelo assistente de IA (resolver_corretor).
 * Mesma chave de comparação da importação da planilha — ver lib/import/normalize.ts.
 */

import { describe, expect, it } from "vitest";
import { rankBrokerMatches } from "@/lib/ai/broker-match";
import type { BrokerRow } from "@/types/database";

function makeBroker(fullName: string, overrides: Partial<BrokerRow> = {}): BrokerRow {
  return {
    id: fullName,
    organization_id: "org-1",
    full_name: fullName,
    short_name: null,
    email: null,
    phone: null,
    document_number: null,
    default_split_mode: "percentage",
    default_split_rate: 40,
    default_split_fixed_amount: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    created_by: null,
    updated_by: null,
    ...overrides,
  };
}

const BROKERS = [
  makeBroker("Marcos Fábio"),
  makeBroker("Leonardo Farias"),
  makeBroker("Ana Paula Souza"),
  makeBroker("Ana Beatriz"),
];

describe("rankBrokerMatches", () => {
  it("casa nome exato ignorando acento e caixa", () => {
    const result = rankBrokerMatches("marcos fabio", BROKERS);
    expect(result.map((b) => b.full_name)).toEqual(["Marcos Fábio"]);
  });

  it("casa por acento diferente ('joão' vs 'Joao')", () => {
    const brokers = [makeBroker("João Vitor"), ...BROKERS];
    const result = rankBrokerMatches("Joao Vitor", brokers);
    expect(result.map((b) => b.full_name)).toEqual(["João Vitor"]);
  });

  it("casa nome parcial e devolve os candidatos ambíguos", () => {
    const result = rankBrokerMatches("ana", BROKERS);
    expect(result.map((b) => b.full_name).sort()).toEqual(["Ana Beatriz", "Ana Paula Souza"]);
  });

  it("prioriza igualdade e prefixo sobre substring", () => {
    const brokers = [makeBroker("Farias"), makeBroker("Leonardo Farias")];
    const result = rankBrokerMatches("farias", brokers);
    expect(result.map((b) => b.full_name)).toEqual(["Farias", "Leonardo Farias"]);
  });

  it("não devolve nada para nome sem nenhuma relação", () => {
    expect(rankBrokerMatches("Zzzz Inexistente", BROKERS)).toEqual([]);
  });

  it("não devolve tudo para consulta vazia", () => {
    expect(rankBrokerMatches("", BROKERS)).toEqual([]);
  });
});
