import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Tabelas semanticamente corretas, densas e com números alinhados.
 * Em telas pequenas a rolagem é interna, para não empurrar a página.
 */
export function TableWrapper({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("w-full overflow-x-auto overscroll-x-contain", className)} {...props} />;
}

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <table
      className={cn("w-full border-collapse text-[13px] tabular", className)}
      {...props}
    />
  );
}

export function THead({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      className={cn("border-b border-border bg-surface-sunken", className)}
      {...props}
    />
  );
}

export function TBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-border", className)} {...props} />;
}

export function TR({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      className={cn("transition-colors duration-100 hover:bg-surface-sunken", className)}
      {...props}
    />
  );
}

export function TH({
  className,
  numeric,
  ...props
}: React.ComponentProps<"th"> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        "h-9 px-3.5 text-left align-middle text-[11px] font-semibold uppercase tracking-[0.045em] text-subtle",
        numeric && "text-right",
        className,
      )}
      {...props}
    />
  );
}

export function TD({
  className,
  numeric,
  ...props
}: React.ComponentProps<"td"> & { numeric?: boolean }) {
  return (
    <td
      className={cn("px-3.5 py-2.5 align-middle", numeric && "text-right", className)}
      {...props}
    />
  );
}

export function TFoot({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      className={cn(
        "border-t border-border-strong bg-surface-sunken font-semibold text-foreground",
        className,
      )}
      {...props}
    />
  );
}
