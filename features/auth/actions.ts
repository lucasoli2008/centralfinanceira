"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logServerError } from "@/lib/errors";

export interface AuthActionState {
  error?: string;
  success?: string;
}

const credentialsSchema = z.object({
  email: z.email("Informe um e-mail válido."),
  password: z.string().min(1, "Informe sua senha."),
});

const emailSchema = z.object({ email: z.email("Informe um e-mail válido.") });

const passwordSchema = z
  .object({
    password: z.string().min(8, "A senha deve ter pelo menos 8 caracteres."),
    confirmation: z.string(),
  })
  .refine((values) => values.password === values.confirmation, {
    path: ["confirmation"],
    message: "As senhas não coincidem.",
  });

export async function signIn(
  _state: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revise os dados informados." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    logServerError("auth.signIn", error);
    return { error: "E-mail ou senha incorretos." };
  }

  const target = String(formData.get("redirecionar") ?? "/dashboard");
  redirect(target.startsWith("/") ? target : "/dashboard");
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordReset(
  _state: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = emailSchema.safeParse({ email: formData.get("email") });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Informe um e-mail válido." };
  }

  const supabase = await createSupabaseServerClient();
  const headerList = await headers();
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ??
    `${headerList.get("x-forwarded-proto") ?? "https"}://${headerList.get("host")}`;

  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/callback?next=/redefinir-senha`,
  });

  if (error) {
    logServerError("auth.requestPasswordReset", error);
  }

  // Resposta sempre igual: não revela se o e-mail existe.
  return {
    success:
      "Se este e-mail estiver cadastrado, enviaremos as instruções para redefinir a senha em instantes.",
  };
}

export async function updatePassword(
  _state: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = passwordSchema.safeParse({
    password: formData.get("password"),
    confirmation: formData.get("confirmation"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revise os dados informados." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error: "O link de redefinição expirou. Solicite um novo e-mail de recuperação.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    logServerError("auth.updatePassword", error);
    return { error: "Não foi possível atualizar a senha. Solicite um novo link de recuperação." };
  }

  redirect("/dashboard");
}
