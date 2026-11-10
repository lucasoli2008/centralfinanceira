import { describe, expect, it } from "vitest";
import {
  fingerprint,
  guessCsvMapping,
  parseCsvStatement,
  parseDate,
  parseMoney,
  parseOfx,
  readCsvTable,
} from "@/lib/finance/statement-parsers";

describe("parseMoney", () => {
  it.each([
    ["1.234,56", 1234.56],
    ["-1.234,56", -1234.56],
    ["1,234.56", 1234.56],
    ["-350.00", -350],
    ["(15,90)", -15.9],
    ["R$ 10,00", 10],
    ["10,00 D", -10],
    ["10,00 C", 10],
    ["1.000.000", 1000000],
    ["0,1", 0.1],
  ])("%s → %d", (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it("recusa texto que não é valor", () => {
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("")).toBeNull();
  });
});

describe("parseDate", () => {
  it("entende os formatos comuns", () => {
    expect(parseDate("05/03/2026")).toBe("2026-03-05");
    expect(parseDate("5/3/26")).toBe("2026-03-05");
    expect(parseDate("2026-03-05")).toBe("2026-03-05");
    expect(parseDate("20260305120000[-3:BRT]")).toBe("2026-03-05");
    expect(parseDate("03/05/2026", "mdy")).toBe("2026-03-05");
  });

  it("recusa datas impossíveis", () => {
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("ontem")).toBeNull();
  });
});

const OFX = `OFXHEADER:100
DATA:OFXSGML
CHARSET:1252

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKTRANLIST>
<DTSTART>20260301
<DTEND>20260331
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260305
<TRNAMT>-350.00
<FITID>A1
<MEMO>PAG BOLETO ENERGIA
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260306100000[-3:BRT]
<TRNAMT>1200,00
<FITID>A2
<NAME>PIX RECEBIDO
<MEMO>TAXA ADM APTO 302
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>1850.00<DTASOF>20260331</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

describe("parseOfx", () => {
  it("lê transações, saldo e período", () => {
    const result = parseOfx(OFX);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({ externalId: "ofx:A1", postedOn: "2026-03-05", amount: -350, description: "PAG BOLETO ENERGIA" });
    expect(result.lines[1]).toMatchObject({ amount: 1200, description: "PIX RECEBIDO", memo: "TAXA ADM APTO 302" });
    expect(result.balance).toBe(1850);
    expect(result.balanceDate).toBe("2026-03-31");
    expect(result.periodStart).toBe("2026-03-01");
  });

  it("usa impressão digital quando o FITID se repete", () => {
    const repeated = OFX.replace("<FITID>A2", "<FITID>A1");
    const result = parseOfx(repeated);
    expect(new Set(result.lines.map((line) => line.externalId)).size).toBe(2);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("recusa arquivo que não é OFX", () => {
    expect(() => parseOfx("data;valor")).toThrow(/OFX/);
  });
});

describe("CSV", () => {
  const csv = `Extrato conta corrente
Data;Histórico;Documento;Valor
01/03/2026;SALDO ANTERIOR;;1.000,00
05/03/2026;PAG BOLETO ENERGIA;123;-350,00
06/03/2026;PIX RECEBIDO;;1.200,00
06/03/2026;PIX RECEBIDO;;1.200,00
`;

  it("acha o cabeçalho, adivinha as colunas e ignora linhas de saldo", () => {
    const table = readCsvTable(csv);
    expect(table.delimiter).toBe(";");
    expect(table.headers).toEqual(["Data", "Histórico", "Documento", "Valor"]);
    const mapping = guessCsvMapping(table.headers);
    expect(mapping).toMatchObject({ date: 0, description: 1, amount: 3, document: 2 });
    const result = parseCsvStatement(table, mapping);
    expect(result.lines.map((line) => line.amount)).toEqual([-350, 1200, 1200]);
  });

  it("gera ids estáveis e distintos para transações idênticas do mesmo dia", () => {
    const table = readCsvTable(csv);
    const first = parseCsvStatement(table, guessCsvMapping(table.headers));
    const second = parseCsvStatement(readCsvTable(csv), guessCsvMapping(table.headers));
    expect(first.lines.map((line) => line.externalId)).toEqual(second.lines.map((line) => line.externalId));
    expect(new Set(first.lines.map((line) => line.externalId)).size).toBe(3);
  });

  it("aceita colunas separadas de crédito e débito", () => {
    const table = readCsvTable(`Data,Descrição,Crédito,Débito\n2026-03-05,Tarifa,,15.90\n2026-03-06,Depósito,500.00,\n`);
    const mapping = guessCsvMapping(table.headers);
    expect(mapping.credit).toBe(2);
    expect(mapping.debit).toBe(3);
    expect(parseCsvStatement(table, mapping).lines.map((line) => line.amount)).toEqual([-15.9, 500]);
  });

  it("fingerprint é determinística", () => {
    expect(fingerprint("abc")).toBe(fingerprint("abc"));
    expect(fingerprint("abc")).not.toBe(fingerprint("abd"));
  });
});
