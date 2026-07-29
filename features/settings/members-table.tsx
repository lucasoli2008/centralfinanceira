"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableWrapper, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField, Input, NativeSelect } from "@/components/ui/field";
import { inviteAdministrator, setMemberStatus } from "./actions";
import { formatDate } from "@/lib/formatting/date";
import { MEMBER_ROLE_LABELS } from "@/lib/formatting/labels";
import type { MemberSummary } from "@/server/queries/organization";

export function MembersTable({
  members,
  currentUserId,
  isOwner,
}: {
  members: MemberSummary[];
  currentUserId: string;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [fullName, setFullName] = React.useState("");
  const [role, setRole] = React.useState<"owner" | "admin">("admin");
  const [pending, setPending] = React.useState(false);

  async function sendInvite(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    const result = await inviteAdministrator({ email, fullName, role });
    setPending(false);

    if (result.status === "error") {
      toast.error(result.message);
      return;
    }

    toast.success("Convite enviado.");
    setInviteOpen(false);
    setEmail("");
    setFullName("");
    router.refresh();
  }

  async function toggleStatus(member: MemberSummary) {
    const nextStatus = member.status === "active" ? "inactive" : "active";
    const result = await setMemberStatus(member.id, nextStatus);

    if (result.status === "error") {
      toast.error(result.message);
      return;
    }

    toast.success(nextStatus === "active" ? "Administrador reativado." : "Administrador desativado.");
    router.refresh();
  }

  return (
    <>
      {isOwner ? (
        <div className="mb-4 flex justify-end">
          <Button onClick={() => setInviteOpen(true)}>
            <Plus />
            Convidar administrador
          </Button>
        </div>
      ) : null}

      <div className="surface-card overflow-hidden">
        <TableWrapper>
          <Table>
            <caption className="sr-only">Administradores da organização</caption>
            <THead>
              <TR>
                <TH>Nome</TH>
                <TH>Papel</TH>
                <TH>Situação</TH>
                <TH>Desde</TH>
                {isOwner ? (
                  <TH className="w-10">
                    <span className="sr-only">Ações</span>
                  </TH>
                ) : null}
              </TR>
            </THead>
            <TBody>
              {members.map((member) => (
                <TR key={member.id}>
                  <TD>
                    {member.fullName}
                    {member.userId === currentUserId ? (
                      <span className="ml-2 text-xs text-subtle">(você)</span>
                    ) : null}
                  </TD>
                  <TD>{MEMBER_ROLE_LABELS[member.role]}</TD>
                  <TD>
                    {member.status === "active" && member.isActive ? (
                      <Badge tone="positive">Ativo</Badge>
                    ) : (
                      <Badge tone="neutral">Inativo</Badge>
                    )}
                  </TD>
                  <TD>{formatDate(member.createdAt)}</TD>
                  {isOwner ? (
                    <TD>
                      {member.userId !== currentUserId ? (
                        <Button variant="secondary" size="sm" onClick={() => toggleStatus(member)}>
                          {member.status === "active" ? "Desativar" : "Reativar"}
                        </Button>
                      ) : null}
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrapper>
      </div>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convidar administrador</DialogTitle>
            <DialogDescription>
              Enviamos um e-mail de convite pelo Supabase Auth. Não existe cadastro público — só o
              proprietário pode criar novos administradores.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={sendInvite} className="space-y-4">
            <FormField label="Nome completo" htmlFor="invite-name" required>
              <Input
                id="invite-name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                required
              />
            </FormField>
            <FormField label="E-mail" htmlFor="invite-email" required>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Papel" htmlFor="invite-role">
              <NativeSelect
                id="invite-role"
                value={role}
                onChange={(event) => setRole(event.target.value as "owner" | "admin")}
              >
                <option value="admin">Administrador</option>
                <option value="owner">Proprietário</option>
              </NativeSelect>
            </FormField>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setInviteOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                Enviar convite
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
