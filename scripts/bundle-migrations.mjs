// Junta todas as migrations em um único arquivo, para colar no SQL Editor do
// Supabase quando não há acesso direto ao Postgres.
//
//   npm run db:bundle   ->   dist/migrations.sql
import fs from "node:fs/promises";
import path from "node:path";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const outputDir = path.join(process.cwd(), "dist");
const outputFile = path.join(outputDir, "migrations.sql");

const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();

const parts = [
  "-- Central Financeira — todas as migrations, na ordem de aplicação.",
  `-- Gerado em ${new Date().toISOString()} por scripts/bundle-migrations.mjs`,
  "-- Cole este arquivo inteiro no SQL Editor do Supabase e execute.",
  "",
];

for (const file of files) {
  const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
  parts.push(`-- ============================================================`);
  parts.push(`-- ${file}`);
  parts.push(`-- ============================================================`);
  parts.push(sql.trimEnd(), "");
}

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(outputFile, parts.join("\n"), "utf8");

console.log(`${files.length} migrations agrupadas em dist/migrations.sql`);
