"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { requestPasswordReset, updatePassword, type AuthActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/field";

function Feedback({ state }: { state: AuthActionState }) {
  if (state.error) {
    return (
      <p
        role="alert"
        className="flex items-start gap-2 rounded-control bg-danger-soft px-3 py-2 text-[13px] text-danger"
      >
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        {state.error}
      </p>
    );
  }

  if (state.success) {
    return (
      <p
        role="status"
        className="flex items-start gap-2 rounded-control bg-positive-soft px-3 py-2 text-[13px] text-positive"
      >
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
        {state.success}
      </p>
    );
  }

  return null;
}

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function PasswordResetRequestForm() {
  const [state, formAction] = useActionState<AuthActionState, FormData>(requestPasswordReset, {});

  return (
    <form action={formAction} className="space-y-4">
      <FormField label="E-mail" htmlFor="email" required>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="voce@imobiliaria.com.br"
        />
      </FormField>

      <Feedback state={state} />
      <SubmitButton label="Enviar link de recuperação" pendingLabel="Enviando…" />
    </form>
  );
}

export function NewPasswordForm() {
  const [state, formAction] = useActionState<AuthActionState, FormData>(updatePassword, {});

  return (
    <form action={formAction} className="space-y-4">
      <FormField label="Nova senha" htmlFor="password" required>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </FormField>

      <FormField label="Confirmar nova senha" htmlFor="confirmation" required>
        <Input
          id="confirmation"
          name="confirmation"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </FormField>

      <Feedback state={state} />
      <SubmitButton label="Salvar nova senha" pendingLabel="Salvando…" />
    </form>
  );
}
