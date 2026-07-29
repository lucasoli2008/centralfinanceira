"use client";

import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn("text-[12.5px] font-medium leading-none text-foreground", className)}
      {...props}
    />
  );
}

/** Estilo compartilhado por todos os controles de formulário. */
export const controlClasses = [
  "w-full rounded-control border border-border-strong bg-surface px-2.5",
  "text-[13px] text-foreground shadow-card",
  "transition-[border-color,box-shadow] duration-150",
  "placeholder:text-subtle",
  "focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent-soft",
  "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted disabled:shadow-none",
  "aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger-soft",
].join(" ");

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(controlClasses, "h-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(controlClasses, "min-h-20 py-2 leading-relaxed", className)} {...props} />;
}

const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%238f8f8a' stroke-width='2.25' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";

export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(controlClasses, "h-9 cursor-pointer appearance-none bg-no-repeat pr-8", className)}
      style={{ backgroundImage: CHEVRON, backgroundPosition: "right 0.5rem center" }}
      {...props}
    />
  );
}

/** Caixa de seleção com área de clique confortável. */
export function Checkbox({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type="checkbox"
      className={cn(
        "size-4 shrink-0 cursor-pointer rounded-[5px] border-border-strong text-accent",
        "accent-[var(--accent)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft",
        className,
      )}
      {...props}
    />
  );
}

interface FormFieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** Campo com rótulo, dica e erro associados por aria-describedby. */
export function FormField({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  children,
}: FormFieldProps) {
  const describedBy = [hint ? `${htmlFor}-hint` : null, error ? `${htmlFor}-error` : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        ) : null}
      </Label>
      <div aria-describedby={describedBy || undefined}>{children}</div>
      {hint && !error ? (
        <p id={`${htmlFor}-hint`} className="text-[11.5px] leading-snug text-subtle">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-[11.5px] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Bloco de aviso inline, reutilizado em formulários e páginas. */
export function Callout({
  tone = "info",
  className,
  children,
}: {
  tone?: "info" | "warning" | "danger" | "positive";
  className?: string;
  children: React.ReactNode;
}) {
  const tones = {
    info: "bg-info-soft text-info",
    warning: "bg-warning-soft text-warning",
    danger: "bg-danger-soft text-danger",
    positive: "bg-positive-soft text-positive",
  } as const;

  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-control px-3 py-2 text-[12.5px] leading-snug",
        tones[tone],
        className,
      )}
    >
      {children}
    </div>
  );
}
