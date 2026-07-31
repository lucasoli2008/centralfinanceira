/**
 * Casamento de nome de corretor falado/digitado com o cadastro.
 *
 * Reaproveita a mesma chave de comparação usada na importação da planilha
 * (`brokerNameKey`), para que "o corretor que a IA encontrou" seja sempre o
 * mesmo que a importação encontraria para o mesmo nome.
 */

import { brokerNameKey } from "@/lib/import/normalize";
import type { BrokerRow } from "@/types/database";

const MAX_MATCHES = 5;

/**
 * Ordena corretores pela proximidade do nome consultado: igualdade exata da
 * chave normalizada primeiro, depois prefixo, depois substring. Nomes sem
 * nenhuma relação com a consulta não entram no resultado.
 */
export function rankBrokerMatches(query: string, brokers: BrokerRow[]): BrokerRow[] {
  const key = brokerNameKey(query);
  if (key === "") return [];

  const scored = brokers
    .map((broker) => {
      const brokerKey = brokerNameKey(broker.full_name);
      let score = -1;
      if (brokerKey === key) score = 3;
      else if (brokerKey.startsWith(key)) score = 2;
      else if (brokerKey.includes(key)) score = 1;
      return { broker, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.broker.full_name.localeCompare(b.broker.full_name));

  return scored.slice(0, MAX_MATCHES).map((entry) => entry.broker);
}
