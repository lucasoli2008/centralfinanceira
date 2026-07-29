/**
 * Importação da planilha antiga.
 *
 * O fixture reproduz exatamente as inconsistências encontradas em
 * `CONTROLE_DE_VENDAS_ROBERTA_v5.xlsx`: cabeçalho na linha 8, percentuais em
 * quatro formatos diferentes, nomes de corretor com espaços sobrando, linhas
 * vazias no meio, linha de totais no fim e abas que não são meses.
 */

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  brokerNameKey,
  isTotalsRow,
  monthFromSheetName,
  normalizeBrokerName,
  normalizeSpreadsheetMoney,
  normalizeSpreadsheetPercent,
} from "@/lib/import/normalize";
import { parseSpreadsheet } from "@/server/import/parse-spreadsheet";

const HEADERS = [
  "Nº",
  "Imóvel / Endereço",
  "Tipo",
  "Corretor",
  "Valor da Venda",
  "% Comissão\r\nVenda",
  "Comissão\r\nTotal",
  "% Corretor",
  "% Imob",
  "Repasse\r\nCorretor",
  "Receita\r\nImob",
];

interface FixtureRow {
  index: number;
  description: string;
  propertyType: string;
  broker: string;
  baseAmount: number | string;
  commissionRate: number | string;
  splitRate: number | string;
}

async function buildFixture(): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();

  // Abas que não são meses e devem ser ignoradas.
  const config = workbook.addWorksheet("⚙ Config");
  config.getCell("C14").value = "Nome Completo";
  config.getCell("C15").value = "Rafaela Ferreira";
  workbook.addWorksheet("📊 Geral").getCell("B11").value = "Mês";
  workbook.addWorksheet("📈 Dashboard").getCell("B10").value = "Mês";

  function addMonthSheet(name: string, rows: FixtureRow[]) {
    const sheet = workbook.addWorksheet(name);
    sheet.getCell("C2").value = "CONTROLE DE VENDAS";
    sheet.getCell("B7").value = 1880000; // célula de total acima do cabeçalho

    HEADERS.forEach((header, index) => {
      sheet.getCell(8, index + 2).value = header;
    });

    rows.forEach((row, offset) => {
      const rowNumber = 9 + offset;
      sheet.getCell(rowNumber, 2).value = row.index;
      sheet.getCell(rowNumber, 3).value = row.description;
      sheet.getCell(rowNumber, 4).value = row.propertyType;
      sheet.getCell(rowNumber, 5).value = row.broker;
      sheet.getCell(rowNumber, 6).value = row.baseAmount;
      sheet.getCell(rowNumber, 7).value = row.commissionRate;
      sheet.getCell(rowNumber, 9).value = row.splitRate;
    });

    // Linhas vazias no meio e uma linha de totais no fim, como na planilha real.
    const totalsRow = 9 + rows.length + 3;
    sheet.getCell(totalsRow, 2).value = "TOTAIS DO MÊS";
    sheet.getCell(totalsRow, 6).value = 1880000;

    return sheet;
  }

  addMonthSheet("Jan", [
    {
      index: 1,
      description: "LUIZ E ALEX",
      propertyType: "Residencial",
      broker: "Marcos Fábio ", // espaço sobrando, como na planilha
      baseAmount: 1200000,
      commissionRate: 0.05, // fração
      splitRate: 0.5, // fração
    },
    {
      index: 2,
      description: "ANA E FELIPE",
      propertyType: "Residencial",
      broker: "Marcos   Fábio", // espaços duplicados
      baseAmount: "R$ 330.000,00", // texto monetário
      commissionRate: "5%", // texto com símbolo
      splitRate: "50%",
    },
  ]);

  addMonthSheet("Fev", [
    {
      index: 1,
      description: "FERNANDA E ANA",
      propertyType: "Residencial",
      broker: "Leonardo Farias",
      baseAmount: 185000,
      commissionRate: "5%",
      splitRate: "40%",
    },
    {
      index: 2,
      description: "ISABEL E ADRIANA",
      propertyType: "Comercial",
      broker: "Rafaela Ferreira",
      baseAmount: 280000,
      commissionRate: 6, // pontos percentuais
      splitRate: 40,
    },
  ]);

  // Mês sem movimento: apenas cabeçalho e totais.
  addMonthSheet("Mar", []);

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

describe("normalização de percentuais", () => {
  it("converte fração para pontos percentuais e sinaliza a conversão", () => {
    expect(normalizeSpreadsheetPercent(0.05)).toEqual({ value: 5, convertedFromFraction: true });
    expect(normalizeSpreadsheetPercent(0.06)).toEqual({ value: 6, convertedFromFraction: true });
    expect(normalizeSpreadsheetPercent(1)).toEqual({ value: 100, convertedFromFraction: true });
  });

  it("mantém valores já em pontos percentuais", () => {
    expect(normalizeSpreadsheetPercent(6)).toEqual({ value: 6, convertedFromFraction: false });
    expect(normalizeSpreadsheetPercent(5.5)).toEqual({ value: 5.5, convertedFromFraction: false });
    expect(normalizeSpreadsheetPercent("6%")).toEqual({ value: 6, convertedFromFraction: false });
    expect(normalizeSpreadsheetPercent("5,5%")).toEqual({ value: 5.5, convertedFromFraction: false });
    expect(normalizeSpreadsheetPercent("40%")).toEqual({ value: 40, convertedFromFraction: false });
  });

  it("devolve null para células vazias ou inválidas", () => {
    expect(normalizeSpreadsheetPercent(null).value).toBeNull();
    expect(normalizeSpreadsheetPercent("").value).toBeNull();
    expect(normalizeSpreadsheetPercent("—").value).toBeNull();
  });
});

describe("normalização monetária", () => {
  it("aceita os formatos usados na planilha", () => {
    expect(normalizeSpreadsheetMoney(500000)).toBe(500000);
    expect(normalizeSpreadsheetMoney("R$ 500.000,00")).toBe(500000);
    expect(normalizeSpreadsheetMoney("500.000,00")).toBe(500000);
    expect(normalizeSpreadsheetMoney("330000")).toBe(330000);
    expect(normalizeSpreadsheetMoney("1.234,56")).toBe(1234.56);
  });
});

describe("normalização de nomes de corretor", () => {
  it("remove espaços duplicados e das pontas, preservando a grafia", () => {
    expect(normalizeBrokerName("  Marcos   Fábio ")).toBe("Marcos Fábio");
    expect(normalizeBrokerName("Leonardo Farias")).toBe("Leonardo Farias");
  });

  it("compara sem diferenciar caixa nem acento, sem unir nomes diferentes", () => {
    expect(brokerNameKey("Marcos Fábio ")).toBe(brokerNameKey("marcos fabio"));
    expect(brokerNameKey("Rafaela Ferreira")).not.toBe(brokerNameKey("Rafael Ferreira"));
  });
});

describe("detecção de linhas e abas", () => {
  it("reconhece linhas de total", () => {
    expect(isTotalsRow("TOTAIS DO MÊS")).toBe(true);
    expect(isTotalsRow("Total anual")).toBe(true);
    expect(isTotalsRow("LUIZ E ALEX")).toBe(false);
  });

  it("reconhece abas mensais e ignora as demais", () => {
    expect(monthFromSheetName("Jan")).toBe(1);
    expect(monthFromSheetName("Dez")).toBe(12);
    expect(monthFromSheetName("Março")).toBe(3);
    expect(monthFromSheetName("⚙ Config")).toBeNull();
    expect(monthFromSheetName("📈 Dashboard")).toBeNull();
  });
});

describe("parseSpreadsheet", () => {
  it("lê apenas as abas mensais e recalcula todos os valores", async () => {
    const preview = await parseSpreadsheet(await buildFixture(), {
      filename: "CONTROLE_DE_VENDAS_ROBERTA_v5.xlsx",
      year: 2026,
      existingBrokers: [{ id: "broker-existente", full_name: "marcos fabio" }],
    });

    expect(preview.sheetsDetected.map((sheet) => sheet.name)).toEqual(["Jan", "Fev", "Mar"]);
    expect(preview.sheetsIgnored).toContain("⚙ Config");
    expect(preview.sheetsIgnored).toContain("📈 Dashboard");

    // 4 lançamentos válidos; março não tem movimento.
    expect(preview.rows).toHaveLength(4);
    expect(preview.sheetsDetected.find((sheet) => sheet.name === "Mar")?.rows).toBe(0);

    // Nenhuma linha de totais foi importada como lançamento.
    expect(preview.rows.some((row) => row.description.toLowerCase().includes("tota"))).toBe(false);
    expect(preview.skipped.some((row) => row.reason === "Linha de totais.")).toBe(true);
  });

  it("normaliza percentuais mistos e recalcula a comissão", async () => {
    const preview = await parseSpreadsheet(await buildFixture(), {
      filename: "planilha.xlsx",
      year: 2026,
      existingBrokers: [],
    });

    const [primeira, segunda] = preview.rows;

    // 0,05 (fração) => 5%; 1.200.000 × 5% = 60.000; 50% => 30.000
    expect(primeira.commissionRate).toBe(5);
    expect(primeira.grossCommission).toBe(60000);
    expect(primeira.splitRate).toBe(50);
    expect(primeira.brokerPayout).toBe(30000);
    expect(primeira.netRevenue).toBe(30000);
    expect(primeira.warnings.join(" ")).toContain("fração");

    // "R$ 330.000,00" + "5%" => 16.500; 50% => 8.250
    expect(segunda.baseAmount).toBe(330000);
    expect(segunda.commissionRate).toBe(5);
    expect(segunda.grossCommission).toBe(16500);
    expect(segunda.brokerPayout).toBe(8250);
  });

  it("usa o mês da aba com o ano informado, já que a planilha não tem data", async () => {
    const preview = await parseSpreadsheet(await buildFixture(), {
      filename: "planilha.xlsx",
      year: 2025,
      dayOfMonth: 1,
      existingBrokers: [],
    });

    expect(preview.rows.filter((row) => row.sheet === "Jan").every((row) => row.entryDate === "2025-01-01")).toBe(true);
    expect(preview.rows.filter((row) => row.sheet === "Fev").every((row) => row.entryDate === "2025-02-01")).toBe(true);
  });

  it("casa corretores existentes e sinaliza os que serão criados", async () => {
    const preview = await parseSpreadsheet(await buildFixture(), {
      filename: "planilha.xlsx",
      year: 2026,
      existingBrokers: [{ id: "broker-existente", full_name: "Marcos Fábio" }],
    });

    const marcos = preview.brokers.find((broker) => broker.key === brokerNameKey("Marcos Fábio"));
    const leonardo = preview.brokers.find((broker) => broker.key === brokerNameKey("Leonardo Farias"));

    // As duas grafias diferentes de "Marcos Fábio" viraram um único corretor.
    expect(marcos?.rowCount).toBe(2);
    expect(marcos?.existingBrokerId).toBe("broker-existente");

    expect(leonardo?.existingBrokerId).toBeNull();
    expect(preview.brokers).toHaveLength(3);
  });

  it("soma os totais da prévia a partir do motor financeiro", async () => {
    const preview = await parseSpreadsheet(await buildFixture(), {
      filename: "planilha.xlsx",
      year: 2026,
      existingBrokers: [],
    });

    const expectedGross = preview.rows.reduce((total, row) => total + row.grossCommission, 0);
    const expectedNet = preview.rows.reduce((total, row) => total + row.netRevenue, 0);

    expect(preview.totals.entries).toBe(preview.rows.length);
    expect(preview.totals.grossCommission).toBeCloseTo(expectedGross, 2);
    expect(preview.totals.netRevenue).toBeCloseTo(expectedNet, 2);
  });
});
