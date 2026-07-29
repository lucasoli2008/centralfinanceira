// Cria a organização e o primeiro proprietário via Supabase Admin API
// (service role), sem precisar de conexão direta ao Postgres.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://eridyfetqizpljjjkfgu.supabase.co";
const SERVICE_ROLE_KEY = process.argv[2];
const EMAIL = process.argv[3];
const PASSWORD = process.argv[4];

if (!SERVICE_ROLE_KEY || !EMAIL || !PASSWORD) {
  console.error("Uso: node scripts/bootstrap-owner.mjs <service_role_key> <email> <senha>");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log("Criando organização...");
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({
      name: "Roberta Oliveira Imóveis",
      legal_name: "Roberta Oliveira Gestão Imobiliária Ltda",
      accent_color: "#0F5132",
      timezone: "America/Sao_Paulo",
      currency: "BRL",
      locale: "pt-BR",
    })
    .select("id")
    .single();

  if (orgError) {
    console.error("Falha ao criar organização:", orgError.message);
    process.exit(1);
  }
  console.log("Organização criada:", org.id);

  console.log("Criando configurações padrão...");
  const { error: settingsError } = await admin.from("organization_settings").insert({
    organization_id: org.id,
    default_sale_commission_rate: 6,
    default_rental_commission_rate: 100,
    default_broker_split_rate: 40,
    monthly_closing_enabled: true,
    report_header: "Roberta Oliveira Imóveis · Central Financeira",
    report_footer: "Documento gerado automaticamente · Confidencial",
  });

  if (settingsError) {
    console.error("Falha ao criar configurações:", settingsError.message);
    process.exit(1);
  }
  console.log("Configurações criadas.");

  console.log("Criando usuário proprietário...");
  const { data: userResult, error: userError } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "Lucas Oliveira" },
  });

  if (userError) {
    console.error("Falha ao criar usuário:", userError.message);
    process.exit(1);
  }
  console.log("Usuário criado:", userResult.user.id);

  // Pequena espera para garantir que o trigger handle_new_user já criou o profile.
  await new Promise((resolve) => setTimeout(resolve, 800));

  console.log("Vinculando como proprietário da organização...");
  const { error: memberError } = await admin.from("organization_members").insert({
    organization_id: org.id,
    user_id: userResult.user.id,
    role: "owner",
    status: "active",
  });

  if (memberError) {
    console.error("Falha ao vincular membro:", memberError.message);
    process.exit(1);
  }

  console.log("\nTudo pronto!");
  console.log("Organização:", org.id);
  console.log("Usuário:", EMAIL);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
