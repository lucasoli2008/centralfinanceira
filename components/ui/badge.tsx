import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-[0.03em] [&_svg]:size-2.5",
  {
    variants: {
      tone: {
        neutral: "border-border bg-surface-muted text-muted",
        accent: "border-accent-border bg-accent-soft text-accent",
        positive: "border-transparent bg-positive-soft text-positive",
        warning: "border-transparent bg-warning-soft text-warning",
        danger: "border-transparent bg-danger-soft text-danger",
        info: "border-transparent bg-info-soft text-info",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
