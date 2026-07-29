import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Petit_Formal_Script } from "next/font/google";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// Assinatura tipográfica usada no nome da imobiliária no painel de login —
// texto real (não imagem), para ficar nítido em qualquer tamanho e continuar
// acessível a leitores de tela.
const brandScript = Petit_Formal_Script({
  variable: "--font-brand-script",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Central Financeira",
    template: "%s · Central Financeira",
  },
  description:
    "Central financeira de comissões de vendas e locações da imobiliária, com dashboard, relatórios e auditoria.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} ${brandScript.variable} h-full`}
    >
      <body className="min-h-full antialiased">
        <TooltipProvider>
          {children}
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                borderRadius: "0.75rem",
                border: "1px solid var(--border)",
                fontSize: "13px",
              },
            }}
          />
        </TooltipProvider>
      </body>
    </html>
  );
}
