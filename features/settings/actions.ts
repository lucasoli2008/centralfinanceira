"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAppContext, requireOwner } from "@/lib/auth/session";
import { organizationSchema, settingsSchema } from "@/lib/validation/entry";
import { logServerError, toUserMessage } from "@/lib/errors";
import type { ActionResult } from "@/features/entries/actions";

export type SettingsValues = z.input<typeof settingsSchema>;
export type OrganizationValues = z.input<typeof organizationSchema>;

export async function updateFinancialSettings(values: SettingsValues): Promise<ActionResult> {
  const context = await requireOwner();
  const parsed = settingsSchema.safeParse(values);

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Revise as configurações informadas.",
    };
  }

  const settings = parsed.data;
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("organization_settings")
    .update({
      default_sale_commission_mode: settings.defaultSaleCommissionMode,
      default_sale_commission_rate: settings.defaultSaleCommissionRate,
      default_sale_commission_fixed_amount: settings.defaultSaleCommissionFixedAmount ?? null,
      default_rental_commission_mode: settings.defaultRentalCommissionMode,
      default_rental_commission_rate: settings.defaultRentalCommissionRate,
      default_rental_commission_fixed_amount: settings.defaultRentalCommissionFixedAmount ?? null,
      default_broker_split_rate: settings.defaultBrokerSplitRate,
      monthly_closing_enabled: settings.monthlyClosingEnabled,
      report_header: settings.reportHeader ?? null,
      report_footer: settings.reportFooter ?? null,
    })
    .eq("organization_id", context.organization.id);

  if (error) {
    logServerError("settings.updateFinancialSettings", error);
    return { status: "error", message: toUserMessage(error) };
  }

  revalidatePath("/configuracoes/financeiro");
  revalidatePath("/configuracoes/relatorios");
  revalidatePath("/dashboard");
  return { status: "ok" };
}

export async function updateOrganization(values: OrganizationValues): Promise<ActionResult> {
  const context = await requireOwner();
  const parsed = organizationSchema.safeParse(values);

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Revise os dados da empresa.",
    };
  }

  const organization = parsed.data;
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("organizations")
    .update({
      name: organization.name,
      legal_name: organization.legalName ?? null,
      document_number: organization.documentNumber ?? null,
      accent_color: organization.accentColor,
      logo_url: organization.logoUrl || null,
    })
    .eq("id", context.organization.id);

  if (error) {
    logServerError("settings.updateOrganization", error);
    return { status: "error", message: toUserMessage(error) };
  }

  revalidatePath("/", "layout");
  return { status: "ok" };
}

export async function setMemberStatus(
  memberId: string,
  status: "active" | "inactive",
): Promise<ActionResult> {
  await requireOwner();

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("organization_members")
    .update({ status })
    .eq("id", memberId);

  if (error) {
    logServerError("settings.setMemberStatus", error);
    return { status: "error", message: toUserMessage(error) };
  }

  revalidatePath("/configuracoes/usuarios");
  return { status: "ok" };
}

const inviteSchema = z.object({
  email: z.email("Informe um e-mail válido."),
  fullName: z.string().trim().min(1, "Informe o nome do administrador."),
  role: z.enum(["owner", "admin"]).default("admin"),
});

/**
 * Cria um administrador da organização.
 *
 * A service role é usada apenas no servidor e apenas para criar o usuário no
 * Supabase Auth — a chave nunca chega ao navegador.
 */
export async function inviteAdministrator(values: {
  email: string;
  fullName: string;
  role?: "owner" | "admin";
}): Promise<ActionResult<{ userId: string }>> {
  const context = await requireOwner();
  const parsed = inviteSchema.safeParse(values);

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Revise os dados informados.",
    };
  }

  try {
    const admin = createSupabaseAdminClient();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;

    const { data, error } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
      data: { full_name: parsed.data.fullName },
      redirectTo: appUrl ? `${appUrl}/auth/callback?next=/redefinir-senha` : undefined,
    });

    if (error || !data.user) {
      logServerError("settings.inviteAdministrator", error);
      return {
        status: "error",
        message:
          "Não foi possível enviar o convite. Verifique o e-mail informado e as configurações de envio do Supabase.",
      };
    }

    const { error: membershipError } = await admin.from("organization_members").insert({
      organization_id: context.organization.id,
      user_id: data.user.id,
      role: parsed.data.role,
      status: "active",
    });

    if (membershipError) {
      logServerError("settings.inviteAdministrator.membership", membershipError);
      return { status: "error", message: toUserMessage(membershipError) };
    }

    revalidatePath("/configuracoes/usuarios");
    return { status: "ok", data: { userId: data.user.id } };
  } catch (error) {
    logServerError("settings.inviteAdministrator", error);
    return {
      status: "error",
      message:
        "O convite exige a SUPABASE_SERVICE_ROLE_KEY configurada no servidor. Consulte docs/DEPLOYMENT.md.",
    };
  }
}

export async function updateOwnProfile(fullName: string): Promise<ActionResult> {
  const context = await requireAppContext();
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName.trim() })
    .eq("id", context.user.id);

  if (error) {
    logServerError("settings.updateOwnProfile", error);
    return { status: "error", message: toUserMessage(error) };
  }

  revalidatePath("/", "layout");
  return { status: "ok" };
}
