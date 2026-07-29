import Image from "next/image";
import { ShieldCheck, TrendingUp } from "lucide-react";
import { BrandWordmark } from "@/components/brand/brand-mark";

/**
 * Layout de autenticação em duas colunas.
 *
 * O painel esquerdo existe para transmitir o que o produto é (controle
 * financeiro sério, não uma planilha) — com profundidade e um gráfico
 * desenhado em SVG, sem imagem externa e sem peso no carregamento.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="surface-hero dot-grid relative hidden w-[48%] max-w-[600px] flex-col justify-between rounded-none px-12 py-12 lg:flex">
        <div className="relative flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-[9px] bg-white p-1 shadow-card">
            <Image
              src="/brand/roberta-oliveira-mark.png"
              alt=""
              width={24}
              height={24}
              className="object-contain"
            />
          </span>
          <span className="text-[14px] font-semibold tracking-[-0.01em] text-white">
            Central Financeira
          </span>
        </div>

        <div className="relative">
          <p className="label-overline text-white/45">Bem-vindo de volta</p>
          <BrandWordmark
            name="Roberta Oliveira"
            className="mt-1 block text-[42px] text-white"
          />
          <p className="-mt-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-white/55">
            Imóveis
          </p>
          <h2 className="mt-5 max-w-md text-[26px] font-semibold leading-[1.2] tracking-[-0.025em] text-white">
            Cada centavo de comissão no lugar certo.
          </h2>
          <p className="mt-4 max-w-sm text-[13.5px] leading-relaxed text-white/60">
            Vendas e locações em uma base única, repasses calculados sem erro de arredondamento e
            relatórios que você imprime sem revisar duas vezes.
          </p>

          {/* Gráfico decorativo — desenhado, não uma imagem */}
          <div className="mt-9 rounded-card border border-white/12 bg-white/[0.04] p-4 backdrop-blur-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-white/45">
                Receita líquida
              </span>
              <span className="flex items-center gap-1 text-[11px] font-semibold text-white/80">
                <TrendingUp className="size-3" />
                12 meses
              </span>
            </div>

            <svg
              viewBox="0 0 300 72"
              preserveAspectRatio="none"
              className="mt-3 h-16 w-full"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="authTrend" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="white" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="white" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                d="M0,58 L25,52 L50,55 L75,42 L100,46 L125,33 L150,37 L175,26 L200,30 L225,19 L250,22 L275,12 L300,8 L300,72 L0,72 Z"
                fill="url(#authTrend)"
              />
              <path
                d="M0,58 L25,52 L50,55 L75,42 L100,46 L125,33 L150,37 L175,26 L200,30 L225,19 L250,22 L275,12 L300,8"
                fill="none"
                stroke="white"
                strokeOpacity="0.85"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              <circle cx="300" cy="8" r="3" fill="white" />
            </svg>

            <div className="mt-1 grid grid-cols-3 gap-2 border-t border-white/10 pt-3">
              {[
                { label: "Vendas", value: "6%" },
                { label: "Locações", value: "100%" },
                { label: "Repasse", value: "40%" },
              ].map((item) => (
                <div key={item.label}>
                  <p className="text-[10px] uppercase tracking-[0.05em] text-white/40">
                    {item.label}
                  </p>
                  <p className="text-[13px] font-semibold tabular text-white/90">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <p className="relative flex items-center gap-1.5 text-[11.5px] text-white/40">
          <ShieldCheck className="size-3.5" />
          Acesso restrito à equipe · Sem cadastro público
        </p>
      </aside>

      <main className="flex flex-1 items-center justify-center bg-background px-4 py-10 sm:px-8">
        <div className="w-full max-w-[368px] animate-enter">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex size-8 items-center justify-center rounded-[9px] border border-border bg-surface p-1 shadow-card">
              <Image
                src="/brand/roberta-oliveira-mark.png"
                alt=""
                width={24}
                height={24}
                className="object-contain"
              />
            </span>
            <span className="text-[14px] font-semibold tracking-[-0.01em]">Central Financeira</span>
          </div>

          {children}
        </div>
      </main>
    </div>
  );
}
