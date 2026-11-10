/**
 * Leitura de extratos bancários (OFX e CSV) no navegador, sem dependências.
 * O resultado é uma lista de transações com valor ASSINADO (+ entrada, − saída)
 * e um identificador estável por transação para importação idempotente.
 */

export interface ParsedStatementLine {
  externalId: string;
  postedOn: string; // yyyy-mm-dd
  amount: number; // assinado, 2 casas
  description: string;
  memo: string | null;
  documentNumber: string | null;
}

export interface ParsedStatement {
  format: "ofx" | "csv";
  lines: ParsedStatementLine[];
  balance: number | null;
  balanceDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  warnings: string[];
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Decodifica o arquivo respeitando o charset declarado (OFX de bancos brasileiros costuma ser windows-1252). */
export function decodeStatementFile(bytes: ArrayBuffer): string {
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 600));
  if (/CHARSET:\s*1252|encoding="?(windows-1252|iso-8859-1)/i.test(head)) {
    return new TextDecoder("windows-1252").decode(bytes);
  }
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(bytes) : utf8;
}

/** Valor em formato brasileiro ou internacional: "1.234,56", "-1234.56", "(1.234,56)", "R$ 10,00", "10,00 D". */
export function parseMoney(raw: string): number | null {
  let text = raw.trim();
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (/\s*D$/i.test(text) && !/\d\s*D[a-z]/i.test(text)) {
    negative = true;
    text = text.replace(/\s*D$/i, "");
  }
  text = text.replace(/\s*C$/i, "");
  text = text.replace(/R\$\s?/i, "").replace(/\s/g, "");
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }
  if (text.endsWith("-")) {
    negative = !negative;
    text = text.slice(0, -1);
  }
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma > lastDot) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma && lastComma >= 0) {
    text = text.replace(/,/g, "");
  } else if (lastComma === -1 && (text.match(/\./g)?.length ?? 0) > 1) {
    text = text.replace(/\./g, "");
  }
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return round2(negative ? -value : value);
}

/** Datas: dd/mm/aaaa, dd/mm/aa, dd-mm-aaaa, aaaa-mm-dd, aaaammdd. */
export function parseDate(raw: string, order: "dmy" | "mdy" = "dmy"): string | null {
  const text = raw.trim();
  let year: number;
  let month: number;
  let day: number;
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = text.match(/^(\d{4})(\d{2})(\d{2})/))) {
    [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/))) {
    const a = Number(match[1]);
    const b = Number(match[2]);
    [day, month] = order === "dmy" ? [a, b] : [b, a];
    year = Number(match[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
  } else {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Impressão digital estável (cyrb53, 53 bits em hex) — não é segurança, só identidade. */
export function fingerprint(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/** Para linhas sem ID do banco: data|valor|descrição + ordem entre linhas idênticas do mesmo arquivo. */
function assignFingerprints(lines: Omit<ParsedStatementLine, "externalId">[], prefix: string): ParsedStatementLine[] {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const key = `${line.postedOn}|${line.amount.toFixed(2)}|${line.description.toLowerCase().replace(/\s+/g, " ")}|${line.documentNumber ?? ""}`;
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    return { ...line, externalId: `${prefix}:${fingerprint(`${key}#${occurrence}`)}` };
  });
}

function periodOf(lines: ParsedStatementLine[]) {
  if (lines.length === 0) return { periodStart: null, periodEnd: null };
  const dates = lines.map((line) => line.postedOn).sort();
  return { periodStart: dates[0], periodEnd: dates[dates.length - 1] };
}

// -----------------------------------------------------------------------------
// OFX (SGML 1.x e XML 2.x)
// -----------------------------------------------------------------------------
function ofxTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, "i"));
  if (!match) return null;
  const value = match[1].trim();
  return value.length ? decodeEntities(value) : null;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'");
}

export function parseOfx(text: string): ParsedStatement {
  const warnings: string[] = [];
  if (!/<OFX>/i.test(text)) {
    throw new Error("O arquivo não parece ser um OFX válido.");
  }
  const blocks = text.split(/<STMTTRN>/i).slice(1).map((chunk) => chunk.split(/<\/STMTTRN>/i)[0]);
  const raw: (Omit<ParsedStatementLine, "externalId"> & { fitId: string | null })[] = [];

  for (const block of blocks) {
    const postedOn = parseDate(ofxTag(block, "DTPOSTED") ?? "");
    const amountText = ofxTag(block, "TRNAMT");
    const amount = amountText === null ? null : parseOfxAmount(amountText);
    if (!postedOn || amount === null || amount === 0) {
      warnings.push("Uma transação sem data ou valor válido foi ignorada.");
      continue;
    }
    const name = ofxTag(block, "NAME");
    const memo = ofxTag(block, "MEMO");
    raw.push({
      fitId: ofxTag(block, "FITID"),
      postedOn,
      amount,
      description: (name ?? memo ?? "Sem descrição").slice(0, 300),
      memo: name && memo && memo !== name ? memo.slice(0, 300) : null,
      documentNumber: ofxTag(block, "CHECKNUM") ?? ofxTag(block, "REFNUM"),
    });
  }

  // FITID repetido no mesmo arquivo (alguns bancos repetem) → cai para impressão digital.
  const fitCounts = new Map<string, number>();
  for (const line of raw) if (line.fitId) fitCounts.set(line.fitId, (fitCounts.get(line.fitId) ?? 0) + 1);
  const withFit = raw.filter((line) => line.fitId && fitCounts.get(line.fitId) === 1);
  const withoutFit = raw.filter((line) => !line.fitId || fitCounts.get(line.fitId) !== 1);
  if (withoutFit.length) warnings.push(`${withoutFit.length} transação(ões) sem identificador único do banco; usamos data, valor e descrição.`);

  const lines = [
    ...withFit.map(({ fitId, ...line }) => ({ ...line, externalId: `ofx:${fitId}` })),
    ...assignFingerprints(
      withoutFit.map((line) => ({
        postedOn: line.postedOn,
        amount: line.amount,
        description: line.description,
        memo: line.memo,
        documentNumber: line.documentNumber,
      })),
      "ofxfp",
    ),
  ].sort((a, b) => a.postedOn.localeCompare(b.postedOn));

  const ledger = text.split(/<LEDGERBAL>/i)[1] ?? "";
  const balanceText = ofxTag(ledger, "BALAMT");
  const balance = balanceText === null ? null : parseOfxAmount(balanceText);
  const balanceDate = parseDate(ofxTag(ledger, "DTASOF") ?? "");

  const start = parseDate(ofxTag(text, "DTSTART") ?? "");
  const end = parseDate(ofxTag(text, "DTEND") ?? "");
  const period = periodOf(lines);

  return {
    format: "ofx",
    lines,
    balance,
    balanceDate: balance === null ? null : balanceDate ?? end ?? period.periodEnd,
    periodStart: start ?? period.periodStart,
    periodEnd: end ?? period.periodEnd,
    warnings,
  };
}

/** No OFX o valor é sempre com ponto decimal, mas alguns bancos usam vírgula. */
function parseOfxAmount(text: string): number | null {
  const cleaned = text.trim();
  if (/^[+-]?\d+(\.\d+)?$/.test(cleaned)) return round2(Number(cleaned));
  return parseMoney(cleaned);
}

// -----------------------------------------------------------------------------
// CSV
// -----------------------------------------------------------------------------
export interface CsvTable {
  delimiter: string;
  headers: string[];
  rows: string[][];
}

export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 10);
  const candidates = [";", ",", "\t", "|"];
  let best = ";";
  let bestScore = -1;
  for (const candidate of candidates) {
    const counts = sample.map((line) => splitCsvLine(line, candidate).length);
    const consistent = counts.filter((count) => count === counts[0]).length;
    const score = counts[0] > 1 ? consistent * 10 + counts[0] : 0;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

export function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

/** Lê o CSV e localiza a linha de cabeçalho (bancos costumam pôr linhas de título antes). */
export function readCsvTable(text: string): CsvTable {
  const delimiter = detectDelimiter(text);
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  const parsed = lines.map((line) => splitCsvLine(line, delimiter));
  const width = Math.max(...parsed.map((row) => row.length));
  let headerIndex = parsed.findIndex(
    (row) => row.length >= Math.min(3, width) && row.some((cell) => /data|date/i.test(cell)) && row.some((cell) => /valor|amount|cr[eé]dito|d[eé]bito|hist|descri/i.test(cell)),
  );
  if (headerIndex < 0) headerIndex = 0;
  const headers = parsed[headerIndex].map((cell, index) => cell || `Coluna ${index + 1}`);
  const rows = parsed.slice(headerIndex + 1).filter((row) => row.some((cell) => cell.length > 0));
  return { delimiter, headers, rows };
}

export interface CsvMapping {
  date: number;
  description: number;
  /** Coluna única com valor assinado... */
  amount: number | null;
  /** ...ou colunas separadas de crédito e débito. */
  credit: number | null;
  debit: number | null;
  memo: number | null;
  document: number | null;
  dateOrder: "dmy" | "mdy";
  /** Inverte o sinal (alguns bancos exportam saídas como positivas). */
  invert: boolean;
}

export function guessCsvMapping(headers: string[]): CsvMapping {
  const find = (pattern: RegExp) => {
    const index = headers.findIndex((header) => pattern.test(header));
    return index >= 0 ? index : null;
  };
  const credit = find(/cr[eé]dito|entrada/i);
  const debit = find(/d[eé]bito|sa[ií]da/i);
  const amount = credit !== null && debit !== null ? null : find(/^valor|valor\b|amount|quantia/i);
  return {
    date: find(/^data|date|dt\b/i) ?? 0,
    description: find(/hist[oó]rico|descri|lan[cç]amento|memo|detalhe/i) ?? 1,
    amount: amount ?? (credit === null || debit === null ? 2 : null),
    credit: amount === null ? credit : null,
    debit: amount === null ? debit : null,
    memo: null,
    document: find(/documento|doc\b|n[uú]mero/i),
    dateOrder: "dmy",
    invert: false,
  };
}

const SKIP_DESCRIPTION = /^(saldo|s\s*a\s*l\s*d\s*o|saldo anterior|saldo do dia|saldo final|total)\b/i;

export function parseCsvStatement(table: CsvTable, mapping: CsvMapping): ParsedStatement {
  const warnings: string[] = [];
  const raw: Omit<ParsedStatementLine, "externalId">[] = [];
  let skipped = 0;

  for (const row of table.rows) {
    const cell = (index: number | null) => (index === null ? "" : (row[index] ?? "").trim());
    const description = cell(mapping.description);
    const postedOn = parseDate(cell(mapping.date), mapping.dateOrder);
    if (!postedOn) {
      skipped++;
      continue;
    }
    if (SKIP_DESCRIPTION.test(description)) continue;

    let amount: number | null;
    if (mapping.amount !== null) {
      amount = parseMoney(cell(mapping.amount));
    } else {
      const credit = parseMoney(cell(mapping.credit)) ?? 0;
      const debit = parseMoney(cell(mapping.debit)) ?? 0;
      amount = round2(Math.abs(credit) - Math.abs(debit));
    }
    if (amount === null || amount === 0) {
      skipped++;
      continue;
    }
    if (mapping.invert) amount = -amount;

    raw.push({
      postedOn,
      amount,
      description: (description || "Sem descrição").slice(0, 300),
      memo: cell(mapping.memo) || null,
      documentNumber: cell(mapping.document) || null,
    });
  }

  if (skipped) warnings.push(`${skipped} linha(s) sem data ou valor reconhecível foram ignoradas.`);
  const lines = assignFingerprints(raw, "csv").sort((a, b) => a.postedOn.localeCompare(b.postedOn));
  return { format: "csv", lines, balance: null, balanceDate: null, ...periodOf(lines), warnings };
}
