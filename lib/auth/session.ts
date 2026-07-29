import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  MemberStatus,
  OrganizationRow,
  OrganizationSettingsRow,
} from "@/types/database";
import type { MemberRole } from "@/lib/finance/types";

export interface AppUser {
  id: string;
  email: string | null;
  fullName: string;
}

export interface AppContext {
  user: AppUser;
  organization: OrganizationRow;
  settings: OrganizationSettingsRow;
  role: MemberRole;
  status: MemberStatus;
  isOwner: boolean;
}

/**
 * Contexto da sessão: usuário autenticado, organização ativa e configurações.
 * A organização vem sempre do banco (membership), nunca do cliente.
 */
export const getAppContext = cache(async (): Promise<AppContext | null> => {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: membership } = await supabase
    .from("organization_members")
    .select(
      `role, status,
       organizations:organization_id (
         id, name, legal_name, document_number, logo_url, accent_color,
         timezone, currency, locale, created_at, updated_at
       )`,
    )
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("role", { ascending: true })
    .limit(1)
    .maybeSingle();

  const organization = membership?.organizations as OrganizationRow | undefined;
  if (!membership || !organization) return null;

  const { data: settings } = await supabase
    .from("organization_settings")
    .select("*")
    .eq("organization_id", organization.id)
    .maybeSingle();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (profile && profile.is_active === false) return null;

  return {
    user: {
      id: user.id,
      email: user.email ?? null,
      fullName: profile?.full_name || user.email?.split("@")[0] || "Usuário",
    },
    organization,
    settings: (settings ?? defaultSettings(organization.id)) as OrganizationSettingsRow,
    role: membership.role as MemberRole,
    status: membership.status as MemberStatus,
    isOwner: membership.role === "owner",
  };
});

/** Contexto obrigatório: redireciona para o login quando não há sessão válida. */
export async function requireAppContext(): Promise<AppContext> {
  const context = await getAppContext();
  if (!context) redirect("/login");
  return context;
}

export async function requireOwner(): Promise<AppContext> {
  const context = await requireAppContext();
  if (!context.isOwner) redirect("/configuracoes");
  return context;
}

function defaultSettings(organizationId: string): OrganizationSettingsRow {
  const now = new Date().toISOString();
  return {
    id: "",
    organization_id: organizationId,
    default_sale_commission_mode: "percentage",
    default_sale_commission_rate: 6,
    default_sale_commission_fixed_amount: null,
    default_rental_commission_mode: "percentage",
    default_rental_commission_rate: 100,
    default_rental_commission_fixed_amount: null,
    default_broker_split_rate: 40,
    monthly_closing_enabled: true,
    report_header: null,
    report_footer: null,
    created_at: now,
    updated_at: now,
  };
}
