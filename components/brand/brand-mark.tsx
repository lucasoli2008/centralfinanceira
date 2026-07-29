import * as React from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

interface BrandMarkProps {
  logoUrl: string | null;
  size?: number;
  className?: string;
}

/**
 * Ícone da marca: usa o `logo_url` configurado pelo administrador
 * (Configurações → Empresa). Sem logotipo, cai num monograma discreto —
 * nunca um ícone genérico de "app financeiro qualquer".
 */
export function BrandMark({ logoUrl, size = 30, className }: BrandMarkProps) {
  if (logoUrl) {
    return (
      <Image
        src={logoUrl}
        alt=""
        width={size}
        height={size}
        className={cn("shrink-0 rounded-[7px] object-contain", className)}
        style={{ width: size, height: size }}
        unoptimized
      />
    );
  }

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[7px] bg-accent font-serif text-accent-foreground shadow-card",
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden="true"
    >
      R
    </span>
  );
}

/**
 * Nome da imobiliária com a assinatura tipográfica de marca (fonte cursiva
 * real, não imagem) — usado no painel de login. O texto vem sempre de
 * `organizations.name`, então continua 100% configurável sem alterar código.
 */
export function BrandWordmark({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      className={cn("font-[family-name:var(--font-brand-script)] leading-none", className)}
      style={{ fontFamily: "var(--font-brand-script), cursive" }}
    >
      {name}
    </span>
  );
}
