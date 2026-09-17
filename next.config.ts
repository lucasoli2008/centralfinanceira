import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fontes TTF dos relatórios de Obras precisam ir junto com as funções na Vercel.
  outputFileTracingIncludes: {
    "/api/obras/**": ["./server/reports/fonts/**"],
  },
};

export default nextConfig;
