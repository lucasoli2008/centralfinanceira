import type { Metadata } from "next";
import { NewPasswordForm } from "@/features/auth/password-forms";

export const metadata: Metadata = { title: "Definir nova senha" };

export default function ResetPasswordPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[19px] font-semibold tracking-[-0.02em]">Definir nova senha</h1>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
          Escolha uma senha com pelo menos 8 caracteres.
        </p>
      </div>

      <NewPasswordForm />
    </div>
  );
}
