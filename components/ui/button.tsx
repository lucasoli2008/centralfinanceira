import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-control",
    "text-[13px] font-medium leading-none",
    "transition-[background-color,border-color,color,box-shadow,opacity] duration-150 ease-out",
    "disabled:pointer-events-none disabled:opacity-45",
    "[&_svg]:size-3.5 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-accent-foreground shadow-card hover:bg-accent-hover active:brightness-95",
        secondary:
          "border border-border-strong bg-surface text-foreground shadow-card hover:bg-surface-muted active:bg-surface-muted",
        ghost: "text-muted hover:bg-surface-muted hover:text-foreground",
        danger: "bg-danger text-white shadow-card hover:brightness-110 active:brightness-95",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-2.5",
        md: "h-9 px-3.5",
        lg: "h-10 px-4 text-sm",
        icon: "size-8",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
