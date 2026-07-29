import Link from "next/link";
import type { Metadata } from "next";
import { PasswordResetRequestForm } from "@/features/auth/password-forms";

export const metadata: Metadata = { title: "Recuperar senha" };

export default function RecoverPasswordPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[19px] font-semibold tracking-[-0.02em]">Recuperar senha</h1>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
          Informe seu e-mail e enviaremos um link para criar uma nova senha.
        </p>
      </div>

      <PasswordResetRequestForm />

      <p className="mt-5 text-center text-[12.5px]">
        <Link href="/login" className="font-medium text-accent hover:underline">
          Voltar para o login
        </Link>
      </p>
    </div>
  );
}
