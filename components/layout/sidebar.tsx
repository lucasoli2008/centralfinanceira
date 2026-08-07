"use client";

import * as React from "react";
import Link from "next/link";
import { BrandMark } from "@/components/brand/brand-mark";
import { usePathname } from "next/navigation";
import {
  Building2,
  CalendarRange,
  ChevronsUpDown,
  FileBarChart,
  HardHat,
  History,
  LayoutDashboard,
  KeyRound,
  LogOut,
  Menu,
  Settings,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { cn, initials } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_GROUPS: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Lançamentos",
    items: [
      { href: "/vendas", label: "Vendas", icon: Building2 },
      { href: "/locacoes", label: "Locações", icon: KeyRound },
      { href: "/corretores", label: "Corretores", icon: Users },
    ],
  },
  {
    label: "Obras",
    items: [{ href: "/obras", label: "Obras", icon: HardHat }],
  },
  {
    label: "Análise",
    items: [
      { href: "/meses", label: "Meses", icon: CalendarRange },
      { href: "/relatorios", label: "Relatórios", icon: FileBarChart },
    ],
  },
  {
    label: "Administração",
    items: [
      { href: "/importar", label: "Importar planilha", icon: Upload },
      { href: "/auditoria", label: "Auditoria", icon: History },
      { href: "/lixeira", label: "Lixeira", icon: Trash2 },
      { href: "/configuracoes", label: "Configurações", icon: Settings },
    ],
  },
];

export interface ShellIdentity {
  organizationName: string;
  logoUrl: string | null;
  userName: string;
  userEmail: string | null;
  roleLabel: string;
  onSignOut: () => void;
}

function Brand({ organizationName, logoUrl }: Pick<ShellIdentity, "organizationName" | "logoUrl">) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-4">
      <BrandMark logoUrl={logoUrl} size={30} />
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold leading-tight tracking-[-0.01em]">
          {organizationName}
        </p>
        <p className="text-[11px] leading-tight text-subtle">Central Financeira</p>
      </div>
    </div>
  );
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group relative flex h-8 items-center gap-2.5 rounded-control px-2.5 text-[13px] font-medium transition-colors duration-100",
        isActive
          ? "bg-accent-soft font-semibold text-accent"
          : "text-foreground/80 hover:bg-surface-muted hover:text-foreground",
      )}
    >
      {/* Barra de destaque do item ativo — âncora visual extra, no padrão de
          sidebars de produtos financeiros (Stripe, Linear, Mercury). */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-accent transition-transform duration-150",
          isActive ? "scale-y-100" : "scale-y-0",
        )}
      />
      <Icon
        className={cn(
          "size-[15px] shrink-0 transition-colors",
          isActive ? "text-accent" : "text-subtle group-hover:text-muted",
        )}
      />
      {item.label}
    </Link>
  );
}

function Navigation({ pathname }: { pathname: string }) {
  return (
    <nav className="flex-1 space-y-4 overflow-y-auto px-2.5 pb-4" aria-label="Navegação principal">
      {NAV_GROUPS.map((group, index) => (
        <div key={group.label ?? `group-${index}`}>
          {group.label ? <p className="label-overline px-2.5 pb-1.5">{group.label}</p> : null}
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.href}>
                <NavLink item={item} pathname={pathname} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function UserFooter({ userName, userEmail, roleLabel, onSignOut }: Omit<ShellIdentity, "organizationName" | "logoUrl">) {
  return (
    <div className="border-t border-border p-2.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-surface-muted"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[10.5px] font-semibold text-accent">
              {initials(userName)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-semibold leading-tight">
                {userName}
              </span>
              <span className="block truncate text-[11px] leading-tight text-subtle">
                {roleLabel}
              </span>
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-subtle" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" side="top" className="min-w-56">
          <DropdownMenuLabel>{userEmail ?? "Sessão ativa"}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/configuracoes/empresa">
              <Settings />
              Configurações
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/configuracoes/usuarios">
              <Users />
              Usuários
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => onSignOut()}>
            <LogOut />
            Sair da conta
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function Sidebar(identity: ShellIdentity) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen w-[236px] shrink-0 flex-col border-r border-border bg-surface lg:flex">
      <Brand organizationName={identity.organizationName} logoUrl={identity.logoUrl} />
      <Navigation pathname={pathname} />
      <UserFooter
        userName={identity.userName}
        userEmail={identity.userEmail}
        roleLabel={identity.roleLabel}
        onSignOut={identity.onSignOut}
      />
    </aside>
  );
}

export function MobileNav(identity: ShellIdentity) {
  const pathname = usePathname();

  // Guardamos a rota em que a gaveta foi aberta: ao navegar, ela fecha sozinha,
  // sem efeito e sem ref.
  const [openedAt, setOpenedAt] = React.useState<string | null>(null);
  const open = openedAt === pathname;

  const setOpen = React.useCallback(
    (next: boolean) => setOpenedAt(next ? pathname : null),
    [pathname],
  );

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenedAt(null);
    }
    if (open) document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex size-8 items-center justify-center rounded-control border border-border-strong bg-surface text-muted shadow-card transition-colors hover:text-foreground"
        aria-label="Abrir menu de navegação"
        aria-expanded={open}
      >
        <Menu className="size-4" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex">
          <button
            type="button"
            className="absolute inset-0 bg-[rgb(16_24_40/0.32)] backdrop-blur-[1px]"
            onClick={() => setOpen(false)}
            aria-label="Fechar menu"
          />
          <aside className="relative flex w-[258px] flex-col bg-surface shadow-popover">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-2.5 top-4 rounded-md p-1 text-subtle transition-colors hover:text-foreground"
              aria-label="Fechar menu"
            >
              <X className="size-4" />
            </button>
            <Brand organizationName={identity.organizationName} logoUrl={identity.logoUrl} />
            <Navigation pathname={pathname} />
            <UserFooter
              userName={identity.userName}
              userEmail={identity.userEmail}
              roleLabel={identity.roleLabel}
              onSignOut={identity.onSignOut}
            />
          </aside>
        </div>
      ) : null}
    </div>
  );
}
