import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Inbox, Lock, SearchX } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("animate-pulse rounded-[6px] bg-surface-muted", className)}
      aria-hidden="true"
      {...props}
    />
  );
}

/** Cabeçalho de página em carregamento. */
export function PageHeaderSkeleton() {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-2 h-3 w-72" />
      </div>
      <Skeleton className="h-9 w-44" />
    </div>
  );
}

export function CardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="surface-card px-4 py-3.5">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="mt-2.5 h-7 w-36" />
          <Skeleton className="mt-2.5 h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="surface-card overflow-hidden">
      <div className="flex items-center gap-6 border-b border-border bg-surface-sunken px-3.5 py-2.5">
        <Skeleton className="h-2.5 w-16" />
        <Skeleton className="h-2.5 w-40" />
        <Skeleton className="ml-auto h-2.5 w-20" />
        <Skeleton className="h-2.5 w-24" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="flex items-center gap-6 px-3.5 py-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-56" />
            <Skeleton className="ml-auto h-3 w-20" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("surface-card px-5 py-4", className)}>
      <Skeleton className="h-3.5 w-44" />
      <Skeleton className="mt-1.5 h-2.5 w-56" />
      <div className="mt-5 flex h-[224px] items-end gap-1.5">
        {Array.from({ length: 12 }).map((_, index) => (
          <Skeleton
            key={index}
            className="flex-1"
            style={{ height: `${35 + ((index * 37) % 60)}%` }}
          />
        ))}
      </div>
    </div>
  );
}

/** Esqueleto completo de página de lista (vendas, locações, lixeira…). */
export function ListPageSkeleton() {
  return (
    <>
      <PageHeaderSkeleton />
      <CardsSkeleton />
      <div className="mt-5 flex flex-wrap gap-2">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="mt-4">
        <TableSkeleton />
      </div>
    </>
  );
}

/** Esqueleto completo do dashboard e da visão mensal. */
export function DashboardSkeleton() {
  return (
    <>
      <PageHeaderSkeleton />
      <CardsSkeleton />
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="surface-card px-4 py-3.5">
            <Skeleton className="h-2.5 w-20" />
            <div className="mt-3 space-y-2.5">
              {Array.from({ length: 5 }).map((__, row) => (
                <div key={row} className="flex items-center justify-between gap-4">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <ChartSkeleton className="xl:col-span-2" />
        <ChartSkeleton />
      </div>
    </>
  );
}

interface EmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
  icon?: "inbox" | "search" | "lock" | "alert";
  className?: string;
  children?: React.ReactNode;
}

const ICONS = { inbox: Inbox, search: SearchX, lock: Lock, alert: AlertTriangle };

export function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
  icon = "inbox",
  className,
  children,
}: EmptyStateProps) {
  const Icon = ICONS[icon];

  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-3 px-6 py-14 text-center", className)}
    >
      <span className="flex size-9 items-center justify-center rounded-full border border-border bg-surface-sunken text-subtle">
        <Icon className="size-4" />
      </span>
      <div className="space-y-1">
        <p className="text-[13.5px] font-semibold">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-[12.5px] leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
      {actionLabel && actionHref ? (
        <Button asChild size="sm" className="mt-1">
          <Link href={actionHref}>{actionLabel}</Link>
        </Button>
      ) : null}
      {children}
    </div>
  );
}

export function ErrorState({
  title = "Não foi possível carregar estas informações.",
  description = "Tente novamente em instantes. Se o problema continuar, avise o responsável pelo sistema.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="surface-card flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="flex size-9 items-center justify-center rounded-full bg-danger-soft text-danger">
        <AlertTriangle className="size-4" />
      </span>
      <div className="space-y-1">
        <p className="text-[13.5px] font-semibold">{title}</p>
        <p className="mx-auto max-w-md text-[12.5px] leading-relaxed text-muted">{description}</p>
      </div>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Tentar novamente
        </Button>
      ) : null}
    </div>
  );
}
