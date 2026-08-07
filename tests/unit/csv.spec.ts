import { describe, expect, it } from "vitest";
import { toCsv, type CsvColumn } from "@/lib/csv";

const columns: CsvColumn[] = [
  { key: "name", header: "Nome" },
  { key: "amount", header: "Valor" },
];

/** Remove o BOM UTF-8 (1 caractere) sempre prefixado pelo serializador. */
function withoutBom(csv: string): string {
  return csv.slice(1);
}

describe("toCsv", () => {
  it("gera cabeçalho e linhas separados por ponto e vírgula", () => {
    const csv = toCsv([{ name: "Obra A", amount: 1500.5 }], columns);
    const lines = withoutBom(csv).split("\r\n");

    expect(lines[0]).toBe("Nome;Valor");
    expect(lines[1]).toBe("Obra A;1500.5");
  });

  it("inclui o BOM UTF-8 no início do arquivo", () => {
    const csv = toCsv([], columns);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("escapa valores com ponto e vírgula, vírgula, aspas e quebras de linha", () => {
    const csv = toCsv(
      [{ name: 'Obra "Prioritária"; urgente', amount: "Linha 1\nLinha 2" }],
      columns,
    );
    const [, row] = withoutBom(csv).split("\r\n");

    expect(row).toBe('"Obra ""Prioritária""; urgente";"Linha 1\nLinha 2"');
  });

  it("trata valores nulos ou indefinidos como célula vazia", () => {
    const csv = toCsv([{ name: null, amount: undefined }], columns);
    const [, row] = withoutBom(csv).split("\r\n");

    expect(row).toBe(";");
  });
});
