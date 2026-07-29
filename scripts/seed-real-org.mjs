// Popula a organização REAL (a do proprietário já criado) com dados de
// demonstração: 5 corretores e ~14 meses de lançamentos de vendas e locações.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://eridyfetqizpljjjkfgu.supabase.co";
const SERVICE_ROLE_KEY = process.argv[2];

if (!SERVICE_ROLE_KEY) {
  console.error("Uso: node scripts/seed-real-org.mjs <service_role_key>");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function iso(date) {
  return date.toISOString().slice(0, 10);
}

function addMonths(base, delta) {
  const d = new Date(base);
  d.setMonth(d.getMonth() + delta);
  return d;
}

async function main() {
  const { data: member, error: memberError } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("role", "owner")
    .limit(1)
    .single();

  if (memberError || !member) {
    console.error("Não encontrei a organização do proprietário:", memberError?.message);
    process.exit(1);
  }

  const orgId = member.organization_id;
  console.log("Organização:", orgId);

  const brokerNames = [
    "Rafaela Ferreira",
    "Marcos Fábio",
    "Leonardo Farias",
    "Diego Nogueira",
    "Camila Duarte",
  ];

  console.log("Criando corretores...");
  const { data: brokers, error: brokerError } = await admin
    .from("brokers")
    .insert(
      brokerNames.map((name, index) => ({
        organization_id: orgId,
        full_name: name,
        short_name: name.split(" ")[0],
        email: `${name.toLowerCase().replace(/\s+/g, ".")}@exemplo.com.br`,
        phone: `(22) 9${index + 1}000-000${index + 1}`,
        default_split_mode: "percentage",
        default_split_rate: [40, 50, 40, 45, 30][index],
        is_active: index !== 4,
      })),
    )
    .select("id, full_name");

  if (brokerError) {
    console.error("Falha ao criar corretores:", brokerError.message);
    process.exit(1);
  }
  console.log(`${brokers.length} corretores criados.`);

  const today = new Date();
  const refMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const entries = [];
  const splitsByEntryIndex = [];

  for (let i = 13; i >= 0; i--) {
    if (i === 4) continue; // mês sem movimento, de propósito

    const month = addMonths(refMonth, -i);
    const base = 250000 + (i % 5) * 90000;
    const rate = [4, 5, 5.5, 6][i % 4];

    // Venda principal do mês
    entries.push({
      organization_id: orgId,
      entry_type: "sale",
      entry_date: iso(new Date(month.getFullYear(), month.getMonth(), 6)),
      description: `Venda Apartamento Centro ${String(month.getMonth() + 1).padStart(2, "0")}/${month.getFullYear()}`,
      reference: `VD-${month.getFullYear()}${String(month.getMonth() + 1).padStart(2, "0")}-01`,
      property_type: "residential",
      base_amount: base,
      commission_mode: "percentage",
      commission_rate: rate,
    });
    splitsByEntryIndex.push([{ brokerIndex: i % 4, mode: "percentage", rate: 40 }]);

    if (i % 3 === 0) {
      entries.push({
        organization_id: orgId,
        entry_type: "sale",
        entry_date: iso(new Date(month.getFullYear(), month.getMonth(), 17)),
        description: `Venda Casa Jardim Aurora ${String(month.getMonth() + 1).padStart(2, "0")}/${month.getFullYear()}`,
        reference: `VD-${month.getFullYear()}${String(month.getMonth() + 1).padStart(2, "0")}-02`,
        property_type: "residential",
        base_amount: base + 180000,
        commission_mode: "percentage",
        commission_rate: 6,
      });
      splitsByEntryIndex.push([
        { brokerIndex: 0, mode: "percentage", rate: 40 },
        { brokerIndex: 1, mode: "percentage", rate: 15 },
      ]);
    }

    if (i % 5 === 2) {
      entries.push({
        organization_id: orgId,
        entry_type: "sale",
        entry_date: iso(new Date(month.getFullYear(), month.getMonth(), 21)),
        description: `Venda Sala Comercial Empresarial ${String(month.getMonth() + 1).padStart(2, "0")}/${month.getFullYear()}`,
        reference: `VD-${month.getFullYear()}${String(month.getMonth() + 1).padStart(2, "0")}-03`,
        property_type: "commercial",
        base_amount: 480000,
        commission_mode: "fixed",
        commission_fixed_amount: 25000,
      });
      splitsByEntryIndex.push([{ brokerIndex: 2, mode: "fixed", fixedAmount: 7000 }]);
    }

    // Locação principal do mês
    entries.push({
      organization_id: orgId,
      entry_type: "rental",
      entry_date: iso(new Date(month.getFullYear(), month.getMonth(), 9)),
      description: `Locação Residencial Vila Nova ${String(month.getMonth() + 1).padStart(2, "0")}/${month.getFullYear()}`,
      reference: `LC-${month.getFullYear()}${String(month.getMonth() + 1).padStart(2, "0")}-01`,
      property_type: "residential",
      base_amount: 2400 + (i % 6) * 250,
      commission_mode: "percentage",
      commission_rate: 100,
    });
    splitsByEntryIndex.push([{ brokerIndex: 1 + (i % 3), mode: "percentage", rate: 50 }]);

    if (i % 2 === 1) {
      entries.push({
        organization_id: orgId,
        entry_type: "rental",
        entry_date: iso(new Date(month.getFullYear(), month.getMonth(), 23)),
        description: `Locação Comercial Avenida Central ${String(month.getMonth() + 1).padStart(2, "0")}/${month.getFullYear()}`,
        reference: `LC-${month.getFullYear()}${String(month.getMonth() + 1).padStart(2, "0")}-02`,
        property_type: "commercial",
        base_amount: 5200,
        commission_mode: "percentage",
        commission_rate: 100,
      });
      splitsByEntryIndex.push([
        { brokerIndex: 3, mode: "percentage", rate: 30 },
        { brokerIndex: 4, mode: "fixed", fixedAmount: 500 },
      ]);
    }
  }

  console.log(`Inserindo ${entries.length} lançamentos...`);
  const { data: insertedEntries, error: entriesError } = await admin
    .from("financial_entries")
    .insert(entries)
    .select("id");

  if (entriesError) {
    console.error("Falha ao inserir lançamentos:", entriesError.message);
    process.exit(1);
  }

  const splitRows = [];
  insertedEntries.forEach((entry, index) => {
    for (const split of splitsByEntryIndex[index]) {
      splitRows.push({
        organization_id: orgId,
        entry_id: entry.id,
        broker_id: brokers[split.brokerIndex].id,
        split_mode: split.mode,
        split_rate: split.mode === "percentage" ? split.rate : null,
        split_fixed_amount: split.mode === "fixed" ? split.fixedAmount : null,
      });
    }
  });

  console.log(`Inserindo ${splitRows.length} repasses...`);
  const { error: splitsError } = await admin.from("entry_broker_splits").insert(splitRows);

  if (splitsError) {
    console.error("Falha ao inserir repasses:", splitsError.message);
    process.exit(1);
  }

  // Fecha o mês mais antigo com movimento.
  const closedMonth = addMonths(refMonth, -13);
  await admin.from("monthly_closings").insert({
    organization_id: orgId,
    year: closedMonth.getFullYear(),
    month: closedMonth.getMonth() + 1,
    status: "closed",
    closed_at: new Date().toISOString(),
  });

  console.log("\nDados de demonstração criados com sucesso.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
