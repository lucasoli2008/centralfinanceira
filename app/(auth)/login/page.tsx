import Link from "next/link";
import type { Metadata } from "next";
import { KeyRound } from "lucide-react";
import { LoginForm } from "@/features/auth/login-form";

export const metadata: Metadata = { title: "Entrar" };

const ERROR_MESSAGES: Record<string, string> = {
  link_invalido: "O link utilizado não é válido. Solicite um novo e-mail de recuperação.",
  link_expirado: "O link expirou. Solicite um novo e-mail de recuperação.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirecionar?: string; erro?: string }>;
}) {
  const { redirecionar, erro } = await searchParams;

  return (
    <div className="surface-raised px-6 py-7 sm:px-8 sm:py-8">
      <span className="flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent">
        <KeyRound className="size-[18px]" />
      </span>

      <div className="mb-6 mt-4">
        <h1 className="text-[20px] font-semibold tracking-[-0.02em]">Entrar na conta</h1>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
          Use o e-mail e a senha cadastrados pelo proprietário da imobiliária.
        </p>
      </div>

      {erro && ERROR_MESSAGES[erro] ? (
        <p
          role="alert"
          className="mb-4 rounded-control bg-warning-soft px-3 py-2 text-[12.5px] leading-snug text-warning"
        >
          {ERROR_MESSAGES[erro]}
        </p>
      ) : null}

      <LoginForm redirectTo={redirecionar} />

      <p className="mt-5 text-center text-[12.5px]">
        <Link href="/recuperar-senha" className="font-medium text-accent hover:underline">
          Esqueci minha senha
        </Link>
      </p>

      <p className="mt-8 border-t border-border pt-4 text-center text-[11.5px] leading-relaxed text-subtle">
        Não existe cadastro público. Novos administradores são convidados pelo proprietário da
        organização.
      </p>
    </div>
  );
}
