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
      <p className="mb-4 text-[13px] text-muted">
        O acesso ao <strong className="text-foreground">Controle Financeiro</strong> é separado: Administrador e Financeiro
        lançam e baixam; Gestor consulta e fecha meses; Consulta só lê; Sem acesso não vê o módulo. A permissão é verificada
        no banco de dados, não apenas na tela.
      </p>
      <MembersTable members={members} currentUserId={context.user.id} isOwner={context.isOwner} />
    </div>
  );
}
