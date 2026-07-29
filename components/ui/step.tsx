import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Cabeçalho de seção numerada — usado nos formulários mais longos (lançamento)
 * para transmitir progresso, como um checkout bancário.
 */
export function StepSection({
  index,
  title,
  description,
  action,
  children,
  className,
}: {
  index: number;
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("surface-card p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11.5px] font-bold text-accent">
            {index}
          </span>
          <div>
            <h2 className="section-title">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-[12px] leading-snug text-subtle">{description}</p>
            ) : null}
          </div>
        </div>
        {action}
      </div>

      <div className="mt-4 pl-9">{children}</div>
    </section>
  );
}
