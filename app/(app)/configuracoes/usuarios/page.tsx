import type { Metadata } from "next";
import { requireAppContext } from "@/lib/auth/session";
import { listMembers } from "@/server/queries/organization";
import { MembersTable } from "@/features/settings/members-table";

export const metadata: Metadata = { title: "Usuários" };

export default async function ConfiguracoesUsuariosPage() {
  const context = await requireAppContext();
  const members = await listMembers();

  return (
    <div>
      <p className="mb-4 text-[13px] text-muted">
        Administradores têm acesso completo aos lançamentos, corretores e relatórios. Somente o
        proprietário gerencia outros administradores.
      </p>
      <MembersTable members={members} currentUserId={context.user.id} isOwner={context.isOwner} />
    </div>
  );
}
