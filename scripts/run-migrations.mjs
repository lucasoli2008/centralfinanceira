// Aplica supabase/migrations/*.sql em ordem, via conexão direta ao Postgres.
// Uso: node scripts/run-migrations.mjs "postgresql://postgres:SENHA@db.REF.supabase.co:5432/postgres"
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const connectionString = process.argv[2];
if (!connectionString) {
  console.error("Informe a connection string como argumento.");
  process.exit(1);
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");

async function main() {
  await client.connect();
  console.log("Conectado ao Postgres.");

  const files = (await fs.readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    process.stdout.write(`Aplicando ${file}... `);
    try {
      await client.query(sql);
      console.log("ok");
    } catch (error) {
      console.log("FALHOU");
      console.error(error.message);
      await client.end();
      process.exit(1);
    }
  }

  console.log("Todas as migrations aplicadas com sucesso.");
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
