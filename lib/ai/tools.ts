import "server-only";

import type OpenAI from "openai";
import { z } from "zod";
import { resolvePeriod } from "@/lib/period";
import { safeRatio } from "@/lib/finance/engine";
import type { AmountMode, EntryType, PropertyType } from "@/lib/finance/types";
import {
  getBrokerRanking,
  getBrokerStatement,
  getMonthlySeries,
  getSummary,
  listEntries,
  type EntryFilters,
} from "@/server/queries/entries";
import { findBrokersByName } from "@/server/queries/brokers";

/**
 * Ferramentas do assistente de IA.
 *
 * Cada ferramenta é só uma porta de entrada para uma função que já existe em
 * `server/queries/*` ou `lib/period.ts` — a IA nunca soma, arredonda nem
 * calcula nada por conta própria. Ver docs/AI_ASSISTANT.md.
 */

const FILTER_PROPERTIES = {
  de: { type: "string", description: "Data inicial (YYYY-MM-DD)." },
  ate: { type: "string", description: "Data final (YYYY-MM-DD)." },
  tipo_lancamento: {
    type: "string",
    enum: ["sale", "rental"],
    description: "sale = venda, rental = locação. Omitir para os dois tipos.",
  },
  corretor_id: {
    type: "string",
    description: "UUID do corretor, obtido antes com resolver_corretor.",
  },
  tipo_imovel: {
    type: "string",
    enum: ["residential", "commercial"],
    description: "residential = residencial, commercial = comercial.",
  },
  modo_comissao: {
    type: "string",
    enum: ["percentage", "fixed"],
    description: "percentage = percentual, fixed = valor fixo.",
  },
  busca: { type: "string", description: "Texto livre buscado na descrição/referência." },
} as const;

interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "resolver_periodo",
    description:
      "Traduz um período em linguagem natural (ex.: mês atual, ano anterior, últimos 3 meses) " +
      "exatamente como a interface calcula, incluindo o período anterior equivalente para " +
      "comparação. Use antes de qualquer outra ferramenta quando o usuário falar um período por " +
      "nome em vez de datas exatas.",
    input_schema: {
      type: "object",
      properties: {
        preset: {
          type: "string",
          enum: [
            "este-mes",
            "mes-anterior",
            "ultimos-3-meses",
            "ultimos-6-meses",
            "ano-atual",
            "ano-anterior",
            "mes",
            "personalizado",
          ],
          description: "Predefinição de período. Padrão: este-mes.",
        },
        ano: { type: "integer", description: "Ano, quando preset = mes." },
        mes: { type: "integer", description: "Mês (1-12), quando preset = mes." },
        de: { type: "string", description: "Data inicial (YYYY-MM-DD), quando preset = personalizado." },
        ate: { type: "string", description: "Data final (YYYY-MM-DD), quando preset = personalizado." },
      },
    },
  },
  {
    name: "resolver_corretor",
    description:
      "Encontra o(s) corretor(es) cujo nome mais se aproxima do nome informado, devolvendo o " +
      "broker_id real. Se vier mais de um resultado, pergunte ao usuário qual ele quis dizer em " +
      "vez de escolher sozinho. Se vier vazio, diga que não encontrou nenhum corretor com esse nome.",
    input_schema: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Nome (ou parte do nome) do corretor, como foi falado." },
      },
      required: ["nome"],
    },
  },
  {
    name: "resumo_financeiro",
    description:
      "Totais agregados (comissão bruta, repasses, receita líquida, contagens, margem líquida) " +
      "de um período e filtros. Fonte: report_summary.",
    input_schema: { type: "object", properties: FILTER_PROPERTIES },
  },
  {
    name: "ranking_corretores",
    description:
      "Ranking de corretores no período/filtro. Cada linha já traz pronto: participations (nº de " +
      "negócios), total_payout (repasse total), average_payout ('repasse médio' por negócio), " +
      "ticket_medio ('ticket médio' — valor médio dos negócios, não do repasse) e " +
      "participated_gross_commission. Nunca recalcule essas médias a partir de outros campos — " +
      "use o valor pronto. Para um corretor específico, passe corretor_id — o resultado vem com " +
      "uma única linha.",
    input_schema: { type: "object", properties: FILTER_PROPERTIES },
  },
  {
    name: "serie_mensal",
    description:
      "Evolução mês a mês (comissão bruta, repasses, receita líquida, contagens) dentro de um " +
      "intervalo, com meses sem movimento aparecendo zerados. Use para perguntas sobre tendência " +
      "ou comparação entre meses.",
    input_schema: {
      type: "object",
      properties: FILTER_PROPERTIES,
      required: ["de", "ate"],
    },
  },
  {
    name: "extrato_corretor",
    description:
      "Lista detalhada dos lançamentos e repasses de um corretor específico, com valores linha a " +
      "linha. Use quando o usuário pedir o detalhe (não só o total) da participação de um corretor.",
    input_schema: {
      type: "object",
      properties: {
        corretor_id: { type: "string", description: "UUID do corretor." },
        de: { type: "string", description: "Data inicial (YYYY-MM-DD). Omitir para todo o histórico." },
        ate: { type: "string", description: "Data final (YYYY-MM-DD). Omitir para todo o histórico." },
      },
      required: ["corretor_id"],
    },
  },
  {
    name: "listar_lancamentos",
    description:
      "Lista bruta de lançamentos (vendas/locações) que batem com os filtros, paginada. Use só " +
      "quando o usuário pedir para ver lançamentos individuais, não para totais.",
    input_schema: {
      type: "object",
      properties: {
        ...FILTER_PROPERTIES,
        pagina: { type: "integer", description: "Página, começando em 1. Padrão: 1." },
      },
    },
  },
  {
    name: "gerar_relatorio",
    description:
      "Monta o link de um dos relatórios em PDF que já existem no sistema (mensal, anual, por " +
      "corretor ou filtrado por período/tipo). Não gera número nenhum — só o link; para narrar os " +
      "valores use resumo_financeiro/ranking_corretores separadamente.",
    input_schema: {
      type: "object",
      properties: {
        tipo: {
          type: "string",
          enum: ["mensal", "anual", "corretor", "filtrado"],
          description:
            "mensal precisa de ano+mes; anual precisa de ano; corretor precisa de corretor_id " +
            "(de/ate opcionais); filtrado aceita qualquer combinação de filtros.",
        },
        ano: { type: "integer" },
        mes: { type: "integer" },
        ...FILTER_PROPERTIES,
      },
      required: ["tipo"],
    },
  },
];

/** Ferramentas no formato de function calling da API da OpenAI. */
export const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = TOOL_DEFINITIONS.map(
  (tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }),
);

const filtersSchema = z.object({
  de: z.string().optional(),
  ate: z.string().optional(),
  tipo_lancamento: z.enum(["sale", "rental"]).optional(),
  corretor_id: z.string().optional(),
  tipo_imovel: z.enum(["residential", "commercial"]).optional(),
  modo_comissao: z.enum(["percentage", "fixed"]).optional(),
  busca: z.string().optional(),
});

function toEntryFilters(input: z.infer<typeof filtersSchema>): EntryFilters {
  return {
    from: input.de ?? null,
    to: input.ate ?? null,
    entryType: (input.tipo_lancamento as EntryType | undefined) ?? null,
    brokerId: input.corretor_id ?? null,
    propertyType: (input.tipo_imovel as PropertyType | undefined) ?? null,
    commissionMode: (input.modo_comissao as AmountMode | undefined) ?? null,
    search: input.busca ?? null,
  };
}

const TOOL_SCHEMAS = {
  resolver_periodo: z.object({
    preset: z
      .enum([
        "este-mes",
        "mes-anterior",
        "ultimos-3-meses",
        "ultimos-6-meses",
        "ano-atual",
        "ano-anterior",
        "mes",
        "personalizado",
      ])
      .optional(),
    ano: z.number().int().optional(),
    mes: z.number().int().min(1).max(12).optional(),
    de: z.string().optional(),
    ate: z.string().optional(),
  }),
  resolver_corretor: z.object({ nome: z.string().min(1) }),
  resumo_financeiro: filtersSchema,
  ranking_corretores: filtersSchema,
  serie_mensal: filtersSchema.extend({ de: z.string(), ate: z.string() }),
  extrato_corretor: z.object({
    corretor_id: z.string().min(1),
    de: z.string().optional(),
    ate: z.string().optional(),
  }),
  listar_lancamentos: filtersSchema.extend({ pagina: z.number().int().min(1).optional() }),
  gerar_relatorio: filtersSchema.extend({
    tipo: z.enum(["mensal", "anual", "corretor", "filtrado"]),
    ano: z.number().int().optional(),
    mes: z.number().int().min(1).max(12).optional(),
  }),
} satisfies Record<string, z.ZodTypeAny>;

export type ToolName = keyof typeof TOOL_SCHEMAS;

export function isToolName(name: string): name is ToolName {
  return Object.hasOwn(TOOL_SCHEMAS, name);
}

interface ReportLink {
  tipo: string;
  url: string;
}

/** Extrai o último link de relatório gerado na conversa, se houver. */
export function findReportLink(toolResults: { name: string; output: unknown }[]): string | null {
  for (let i = toolResults.length - 1; i >= 0; i -= 1) {
    const result = toolResults[i];
    if (result.name === "gerar_relatorio" && result.output && typeof result.output === "object") {
      const link = result.output as Partial<ReportLink>;
      if (typeof link.url === "string") return link.url;
    }
  }
  return null;
}

function reportUrl(tipo: string, params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  return `/api/relatorios/${tipo}${query ? `?${query}` : ""}`;
}

/**
 * Executa uma ferramenta. Retorna `{ isError: true, message }` quando a
 * entrada é inválida ou a ferramenta falha — vira um tool_result de erro,
 * para o modelo corrigir e tentar de novo, em vez de travar a conversa.
 */
export async function dispatchTool(
  name: string,
  rawInput: unknown,
): Promise<{ isError: boolean; output: unknown }> {
  if (!isToolName(name)) {
    return { isError: true, output: `Ferramenta desconhecida: ${name}.` };
  }

  const schema = TOOL_SCHEMAS[name];
  const parsed = schema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return {
      isError: true,
      output: `Entrada inválida para ${name}: ${parsed.error.issues[0]?.message ?? "revise os parâmetros."}`,
    };
  }

  try {
    switch (name) {
      case "resolver_periodo": {
        const input = parsed.data as z.infer<typeof TOOL_SCHEMAS.resolver_periodo>;
        const range = resolvePeriod({
          periodo: input.preset,
          ano: input.ano ? String(input.ano) : undefined,
          mes: input.mes ? String(input.mes) : undefined,
          de: input.de,
          ate: input.ate,
        });
        return { isError: false, output: range };
      }

      case "resolver_corretor": {
        const input = parsed.data as z.infer<typeof TOOL_SCHEMAS.resolver_corretor>;
        const matches = await findBrokersByName(input.nome);
        return {
          isError: false,
          output: matches.map((broker) => ({
            corretor_id: broker.id,
            nome: broker.full_name,
            ativo: broker.is_active,
          })),
        };
      }

      case "resumo_financeiro": {
        const input = parsed.data as z.infer<typeof TOOL_SCHEMAS.resumo_financeiro>;
        return { isError: false, output: await getSummary(toEntryFilters(input)) };
      }

      case "ranking_corretores": {
        const input = parsed.data as z.infer<typeof TOOL_SCHEMAS.ranking_corretores>;
        const ranking = await getBrokerRanking(toEntryFilters(input));
        return {
          isError: false,
          output: ranking.map((row) => ({
            ...row,
            ticket_medio: safeRatio(row.participated_base_amount, row.participations),
          })),
        };
      }

      case "serie_mensal": {
        const input = parsed.data as z.infer<typeof TOOL_SCHEMAS.serie_mensal>;
        const filters = toEntryFilters(input);
        return {
          isError: false,
          output: await getMonthlySeries(input.de, input.ate, filters),
        };
      }

      case "extrato_corretor": {
        const input = parsed.data as z.infer<typeof TOOL_SCHEMAS.extrato_corretor>;
        return {
          isError: false,
          output: await getBrokerStatement(input.corretor_id, input.de ?? null, input.ate ?? null),
        };
      }

      case "listar_lancamentos": {
        const input = parsed.data as z.infer<typeof TOOL_SCHEMAS.listar_lancamentos>;
        const { rows, total } = await listEntries(toEntryFilters(input), {
          page: input.pagina ?? 1,
          pageSize: 20,
        });
        return { isError: false, output: { total, lancamentos: rows } };
      }

      case "gerar_relatorio": {
        const input = parsed.data as z.infer<typeof TOOL_SCHEMAS.gerar_relatorio>;

        if (input.tipo === "mensal") {
          if (!input.ano || !input.mes) {
            return { isError: true, output: "Relatório mensal exige ano e mês." };
          }
          return { isError: false, output: { url: reportUrl("mensal", { ano: input.ano, mes: input.mes }) } };
        }

        if (input.tipo === "anual") {
          if (!input.ano) {
            return { isError: true, output: "Relatório anual exige ano." };
          }
          return { isError: false, output: { url: reportUrl("anual", { ano: input.ano }) } };
        }

        if (input.tipo === "corretor") {
          if (!input.corretor_id) {
            return { isError: true, output: "Relatório por corretor exige corretor_id." };
          }
          return {
            isError: false,
            output: {
              url: reportUrl("corretor", { corretor: input.corretor_id, de: input.de, ate: input.ate }),
            },
          };
        }

        return {
          isError: false,
          output: {
            url: reportUrl("filtrado", {
              de: input.de,
              ate: input.ate,
              tipo: input.tipo_lancamento,
              corretor: input.corretor_id,
              imovel: input.tipo_imovel,
              comissao: input.modo_comissao,
              busca: input.busca,
            }),
          },
        };
      }

      default:
        return { isError: true, output: `Ferramenta desconhecida: ${name}.` };
    }
  } catch (error) {
    return {
      isError: true,
      output: error instanceof Error ? error.message : "Falha ao executar a ferramenta.",
    };
  }
}
