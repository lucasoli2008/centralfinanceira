import { BarChart3, FileCheck2, ShieldCheck, Wallet } from "lucide-react";

const HIGHLIGHTS = [
  {
    icon: Wallet,
    title: "Uma base única",
    description: "Vendas e locações no mesmo lugar, sem uma aba por mês.",
  },
  {
    icon: BarChart3,
    title: "Números que fecham",
    description: "Dashboard, tabelas e PDFs sempre com o mesmo total.",
  },
  {
    icon: ShieldCheck,
    title: "Histórico protegido",
    description: "Auditoria de cada alteração e fechamento mensal.",
  },
  {
    icon: FileCheck2,
    title: "Relatórios prontos",
    description: "PDF mensal, anual e por corretor em um clique.",
  },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {/* Painel da marca — apenas em telas grandes */}
      <aside className="relative hidden w-[46%] max-w-[560px] flex-col justify-between overflow-hidden bg-accent px-10 py-12 text-accent-foreground lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
            backgroundSize: "22px 22px",
          }}
        />

        <div className="relative flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-[8px] bg-white/12 backdrop-blur">
            <Wallet className="size-[17px]" />
          </span>
          <span className="text-[14px] font-semibold tracking-[-0.01em]">Central Financeira</span>
        </div>

        <div className="relative">
          <h2 className="max-w-md text-[26px] font-semibold leading-[1.25] tracking-[-0.025em]">
            A planilha frágil ficou para trás.
          </h2>
          <p className="mt-3 max-w-sm text-[13.5px] leading-relaxed text-white/70">
            Controle das comissões da imobiliária com precisão de centavos, histórico auditável e
            relatórios que você pode imprimir sem revisar duas vezes.
          </p>

          <ul className="mt-9 grid gap-x-6 gap-y-5 sm:grid-cols-2">
            {HIGHLIGHTS.map((item) => (
              <li key={item.title}>
                <item.icon className="size-4 text-white/60" />
                <p className="mt-2 text-[13px] font-medium">{item.title}</p>
                <p className="mt-0.5 text-[12px] leading-snug text-white/55">{item.description}</p>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[11.5px] text-white/45">
          Acesso restrito à equipe da imobiliária · Sem cadastro público
        </p>
      </aside>

      {/* Formulário */}
      <main className="flex flex-1 items-center justify-center bg-background px-4 py-10 sm:px-8">
        <div className="w-full max-w-[360px]">
          <div className="mb-7 flex items-center gap-2.5 lg:hidden">
            <span className="flex size-8 items-center justify-center rounded-[8px] bg-accent text-accent-foreground shadow-card">
              <Wallet className="size-[17px]" />
            </span>
            <span className="text-[14px] font-semibold tracking-[-0.01em]">Central Financeira</span>
          </div>

          {children}
        </div>
      </main>
    </div>
  );
}
