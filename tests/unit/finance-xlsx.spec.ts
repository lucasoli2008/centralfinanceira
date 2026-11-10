import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildDre, type DreSourceRow } from "@/lib/finance/dre";
import { buildDreWorkbook, buildProjectionWorkbook } from "@/server/reports/finance-xlsx";

const rows: DreSourceRow[] = [
  { nature: "own_revenue", group_id: "g1", group_name: "Receitas", category_id: "c1", category_name: "Taxa", period_key: "2026-01", amount: 1000 },
  { nature: "operating_expense", group_id: "g2", group_name: "Despesas", category_id: "c2", category_name: "Aluguel", period_key: "2026-02", amount: -400 },
];

async function load(buffer: Buffer) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer as unknown as ArrayBuffer);
  return book;
}

describe("planilhas do financeiro", () => {
  it("DRE traz os meses como colunas e o resultado igual ao montador", async () => {
    const dre = buildDre(rows, ["2026-01", "2026-02"]);
    const book = await load(await buildDreWorkbook(dre, "Roberta", "Jan a fev/2026"));
    const sheet = book.getWorksheet("DRE gerencial")!;
    expect(sheet.getRow(4).values).toEqual([undefined, "Linha", "01/2026", "02/2026", "Total"]);
    let net: unknown[] | null = null;
    sheet.eachRow((row) => {
      if (row.getCell(1).value === "= Resultado líquido") net = (row.values as unknown[]).slice(2);
    });
    expect(net).toEqual([1000, -400, 600]);
  });

  it("fluxo projetado mantém os vencidos na primeira linha", async () => {
    const book = await load(
      await buildProjectionWorkbook(
        [
          { bucket_start: null, bucket_end: null, inflow: 0, outflow: 300, third_party_out: 0, forecast_in: 0, forecast_out: 0, opening_balance: 1000, closing_balance: 700 },
          { bucket_start: "2026-11-09", bucket_end: "2026-11-15", inflow: 500, outflow: 0, third_party_out: 0, forecast_in: 0, forecast_out: 0, opening_balance: 700, closing_balance: 1200 },
        ],
        "Roberta",
        "90 dias",
      ),
    );
    const sheet = book.getWorksheet("Fluxo projetado")!;
    expect(sheet.getRow(5).getCell(1).value).toBe("Vencidos");
    expect(sheet.getRow(6).getCell(9).value).toBe(1200);
  });
});
