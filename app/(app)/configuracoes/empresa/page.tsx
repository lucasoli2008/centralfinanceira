import type { Metadata } from "next";
import { requireAppContext } from "@/lib/auth/session";
import { OrganizationForm } from "@/features/settings/settings-forms";

export const metadata: Metadata = { title: "Empresa e marca" };

export default async function ConfiguracoesEmpresaPage() {
  const context = await requireAppContext();

  return <OrganizationForm organization={context.organization} disabled={!context.isOwner} />;
}
