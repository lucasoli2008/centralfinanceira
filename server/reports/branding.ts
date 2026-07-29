import "server-only";

import { requireAppContext } from "@/lib/auth/session";
import type { ReportBranding } from "./pdf";

/** Marca e identidade dos relatórios, configuráveis pelo administrador. */
export async function getReportBranding(): Promise<{
  branding: ReportBranding;
  organizationId: string;
}> {
  const context = await requireAppContext();

  return {
    organizationId: context.organization.id,
    branding: {
      organizationName: context.organization.name,
      logoUrl: context.organization.logo_url,
      accentColor: context.organization.accent_color,
      header: context.settings.report_header,
      footer: context.settings.report_footer,
      generatedBy: context.user.fullName,
    },
  };
}

export function pdfResponse(buffer: Buffer, filename: string): Response {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
