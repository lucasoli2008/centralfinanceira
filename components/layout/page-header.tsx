import * as React from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  backHref,
  backLabel = "Voltar",
  actions,
  meta,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0">
        {backHref ? (
          <Link
            href={backHref}
            className="mb-1.5 inline-flex items-center gap-1 text-[12.5px] font-medium text-muted transition-colors hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" />
            {backLabel}
          </Link>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <h1 className="page-title">{title}</h1>
          {meta}
        </div>

        {description ? (
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>

      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
