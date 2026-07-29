import type { CSSProperties } from "react";
import { requireAppContext } from "@/lib/auth/session";
import { signOut } from "@/features/auth/actions";
import { Sidebar, type ShellIdentity } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { MEMBER_ROLE_LABELS } from "@/lib/formatting/labels";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const context = await requireAppContext();
  const { organization, user, role } = context;

  // A cor da marca é configurável pelo administrador e aplicada em tempo de
  // execução, sem alterar código.
  const themeStyle = { "--accent": organization.accent_color } as CSSProperties;

  const identity: ShellIdentity = {
    organizationName: organization.name,
    logoUrl: organization.logo_url,
    userName: user.fullName,
    userEmail: user.email,
    roleLabel: MEMBER_ROLE_LABELS[role],
    onSignOut: signOut,
  };

  return (
    <div className="flex min-h-screen bg-background" style={themeStyle}>
      <Sidebar {...identity} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar {...identity} />

        <main className="mx-auto w-full max-w-[1360px] flex-1 px-4 py-6 lg:px-8 lg:py-7">
          {children}
        </main>
      </div>
    </div>
  );
}
