import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { requireAppContext } from "@/lib/auth/session";
import { SettingsNav } from "@/features/settings/settings-nav";

export default async function ConfiguracoesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await requireAppContext();

  return (
    <>
      <PageHeader
        title="Configurações"
        description={
          context.isOwner
            ? "Marca, padrões financeiros, relatórios e usuários da organização."
            : "Somente o proprietário da conta pode alterar estas configurações."
        }
      />

      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <SettingsNav />
        <div>{children}</div>
      </div>

      {!context.isOwner ? (
        <p className="mt-6 rounded-card border border-border bg-surface-muted px-4 py-3 text-[13px] text-muted">
          Você tem acesso de administrador: pode registrar lançamentos, corretores e fechar meses,
          mas as configurações da organização são exclusivas do proprietário. Fale com{" "}
          <Link href="/configuracoes/usuarios" className="font-medium text-accent">
            o proprietário da conta
          </Link>{" "}
          se precisar de uma alteração.
        </p>
      ) : null}
    </>
  );
}
