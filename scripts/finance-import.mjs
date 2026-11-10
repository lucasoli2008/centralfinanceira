#!/usr/bin/env node
/**
 * Lança no Controle Financeiro os gastos/recebimentos extraídos de documentos
 * escaneados, em nome de um usuário real (auditoria normal), via
 * fin_admin_import_entries (migração 0013 — só service_role executa).
 *
 * Uso:
 *   node scripts/finance-import.mjs lote.json                  # prévia, não grava nada
 *   node scripts/finance-import.mjs lote.json --aplicar        # grava o lote inteiro
 *   node scripts/finance-import.mjs --desfazer <lote> --motivo "texto com 10+ caracteres"
 *
 * Opções: --email <login do usuário> (padrão: dono da conta) · --rotulo "Papéis de novembro"
 *
 * Formato de cada linha do JSON (array):
 *   { "date": "2026-11-15", "description": "Salário Ana", "kind": "saida" | "entrada",
 *     "category": "Salários e encargos", "amount": 2000, "paid": true, "paid_on": "2026-11-15",
 *     "account": "Itaú", "payee": "Ana Souza", "payee_kind": "employee",
 *     "recurring": "nao" | "fixo" | "variavel", "document_number": "123", "notes": "..." }
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_EMAIL = "lucasoliveira.application@hotmail.com";

function readEnv() {
  const file = path.join(process.cwd(), ".env.local");
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^"|"$/g, "")];
      }),
  );
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function rpc(env, fn, body) {
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.message ?? text);
  return data;
}

const money = (value) => Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function main() {
  const env = readEnv();
  const email = arg("--email") ?? DEFAULT_EMAIL;

  const undo = arg("--desfazer");
  if (undo) {
    const reason = arg("--motivo");
    const count = await rpc(env, "fin_admin_cancel_import_batch", { p_user_email: email, p_batch_id: undo, p_reason: reason ?? "" });
    console.log(`Lote ${undo} desfeito: ${count} lançamento(s) cancelado(s) e estornado(s).`);
    return;
  }

  const file = process.argv[2];
  if (!file || file.startsWith("--")) {
    console.error("Informe o arquivo JSON do lote.");
    process.exit(1);
  }
  const rows = JSON.parse(readFileSync(file, "utf8"));
  const preview = await rpc(env, "fin_admin_preview_import", { p_user_email: email, p_rows: rows });

  let problems = 0;
  let totalOut = 0;
  let totalIn = 0;
  for (const item of preview) {
    const row = rows[item.line - 1];
    const issues = item.problems ?? [];
    problems += issues.length;
    if (item.kind === "expense") totalOut += Number(row.amount);
    if (item.kind === "income") totalIn += Number(row.amount);
    console.log(
      `${String(item.line).padStart(3)} ${row.date} ${item.kind === "income" ? "+" : "-"}${money(row.amount).padStart(14)}  ${row.description}` +
        `  → ${item.category_name ?? "?"}${row.paid ? ` · pago (${item.account_name ?? "?"})` : " · em aberto"}` +
        `${row.recurring && row.recurring !== "nao" ? ` · recorrente ${row.recurring}` : ""}` +
        (issues.length ? `\n      PROBLEMA: ${issues.join("; ")}` : ""),
    );
  }
  console.log(`\n${rows.length} linha(s) · saídas ${money(totalOut)} · entradas ${money(totalIn)} · ${problems} problema(s)`);

  if (!process.argv.includes("--aplicar")) {
    console.log("Prévia apenas. Rode com --aplicar para gravar.");
    return;
  }
  if (problems > 0) {
    console.error("Corrija os problemas antes de aplicar.");
    process.exit(1);
  }
  const result = await rpc(env, "fin_admin_import_entries", {
    p_user_email: email,
    p_rows: rows,
    p_label: arg("--rotulo") ?? path.basename(file),
  });
  console.log(`Gravado: ${result.count} lançamento(s). Lote ${result.batch_id} (use --desfazer para reverter).`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
