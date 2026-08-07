/**
 * Serializador de CSV, sem dependência externa. Separador `;` e BOM UTF-8
 * para abrir corretamente acentos e números no Excel em português.
 */

export interface CsvColumn {
  key: string;
  header: string;
}

const BOM = String.fromCharCode(0xfeff);

function escapeCsvValue(value: string): string {
  return /[",;\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(
  rows: Record<string, string | number | null | undefined>[],
  columns: CsvColumn[],
): string {
  const header = columns.map((column) => escapeCsvValue(column.header)).join(";");
  const lines = rows.map((row) =>
    columns.map((column) => escapeCsvValue(String(row[column.key] ?? ""))).join(";"),
  );

  return BOM + [header, ...lines].join("\r\n");
}
