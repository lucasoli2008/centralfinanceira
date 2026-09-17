import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { renderWorkReport, renderWorksListReport, type WorkReportData } from "@/server/reports/work-pdf";
import { appendPdfAttachments, toPdfImage } from "@/server/reports/work-attachments";
import type { WorkActivityRow, WorkEntryRow, WorkRow } from "@/types/database";

const branding = {
  organizationName: "Roberta Oliveira Imóveis",
  logoUrl: null,
  accentColor: "#0f5132",
  header: null,
  footer: null,
  generatedBy: "Teste automatizado",
};

const work: WorkRow = {
  id: "11111111-1111-4111-8111-111111111111",
  organization_id: "22222222-2222-4222-8222-222222222222",
  code: "OBR-2026-0007",
  title: "Reforma completa do banheiro social — Apto 302",
  property_label: "Apto 302 — Edifício Aurora",
  address: "Rua das Palmeiras, 123 — Centro, Campinas/SP",
  owner_label: "Maria Souza",
  responsible_name: "João Corretor",
  description: "Troca de revestimento, louças e metais; revisão elétrica e hidráulica; pintura completa.",
  status: "em_andamento",
  category: "reforma",
  priority: "alta",
  requested_at: "2026-03-01",
  started_at: "2026-03-05",
  expected_at: "2026-04-15",
  completed_at: null,
  notes: "Acesso pela portaria B. Síndico autorizou obra das 8h às 17h.",
  is_archived: false,
  archived_at: null,
  archived_by: null,
  archived_reason: null,
  created_by: null,
  updated_by: null,
  created_at: "2026-03-01T12:00:00Z",
  updated_at: "2026-03-20T12:00:00Z",
};

function entry(partial: Partial<WorkEntryRow> & Pick<WorkEntryRow, "id" | "entry_type" | "description" | "total_amount">): WorkEntryRow {
  return {
    organization_id: work.organization_id,
    work_id: work.id,
    entry_date: "2026-03-10",
    category: null,
    supplier_name: null,
    quantity: 1,
    unit: "unidade",
    unit_price: partial.total_amount,
    total_is_manual: false,
    is_paid: false,
    paid_at: null,
    notes: null,
    created_by: null,
    updated_by: null,
    created_at: "2026-03-10T12:00:00Z",
    updated_at: "2026-03-10T12:00:00Z",
    deleted_at: null,
    ...partial,
  };
}

const entries: WorkEntryRow[] = [
  entry({ id: "e1", entry_type: "servico", description: "Mão de obra hidráulica", total_amount: 1800, supplier_name: "Hidráulica Silva", is_paid: true, paid_at: "2026-03-12" }),
  entry({ id: "e2", entry_type: "servico", description: "Pintura completa", total_amount: 2400, category: "pintura" }),
  entry({ id: "e3", entry_type: "material", description: "Porcelanato 60x60", total_amount: 998.75, quantity: 12.5, unit: "m2", unit_price: 79.9, supplier_name: "Casa do Piso" }),
  entry({ id: "e4", entry_type: "outro_custo", description: "Caçamba de entulho", total_amount: 350, is_paid: true, paid_at: "2026-03-15" }),
];

const activities: WorkActivityRow[] = [
  { id: "a1", organization_id: work.organization_id, work_id: work.id, action: "obra_criada", description: "Obra criada: Reforma", created_by: null, created_at: "2026-03-01T12:00:00Z" },
  { id: "a2", organization_id: work.organization_id, work_id: work.id, action: "item_pago", description: "Pagamento registrado: Mão de obra hidráulica — R$ 1800,00", created_by: null, created_at: "2026-03-12T12:00:00Z" },
];

async function fakePhoto(color: { r: number; g: number; b: number }) {
  const buffer = await sharp({ create: { width: 640, height: 480, channels: 3, background: color } }).jpeg().toBuffer();
  const image = await toPdfImage(buffer, "image/jpeg");
  if (!image) throw new Error("imagem de teste inválida");
  return image;
}

async function fakePdf(pages: number): Promise<Buffer> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) document.addPage([595, 842]);
  return Buffer.from(await document.save());
}

describe("renderWorkReport", () => {
  it("gera um PDF válido com fotos, notas em imagem e apêndice em PDF", async () => {
    const data: WorkReportData = {
      branding,
      work,
      totals: { servicesTotal: 4200, materialsTotal: 998.75, otherTotal: 350, grandTotal: 5548.75, paidTotal: 2150, unpaidTotal: 3398.75 },
      entries,
      photos: [
        { id: "p1", category: "foto_antes", caption: "Banheiro antes da obra", image: await fakePhoto({ r: 120, g: 120, b: 120 }) },
        { id: "p2", category: "foto_durante", caption: null, image: await fakePhoto({ r: 200, g: 160, b: 60 }) },
        { id: "p3", category: "foto_depois", caption: "Entrega", image: await fakePhoto({ r: 40, g: 140, b: 90 }) },
      ],
      invoices: [
        {
          id: "i1",
          fileName: "nf-hidraulica.jpg",
          category: "nota_fiscal",
          createdAt: "2026-03-12T12:00:00Z",
          description: null,
          image: await fakePhoto({ r: 250, g: 250, b: 250 }),
          appendixNumber: null,
          skipped: false,
          entry: { description: "Mão de obra hidráulica", totalAmount: 1800, isPaid: true, paidAt: "2026-03-12" },
        },
        {
          id: "i2",
          fileName: "nf-porcelanato.pdf",
          category: "nota_fiscal",
          createdAt: "2026-03-13T12:00:00Z",
          description: "NF-e 4521",
          image: null,
          appendixNumber: 1,
          skipped: false,
          entry: { description: "Porcelanato 60x60", totalAmount: 998.75, isPaid: false, paidAt: null },
        },
      ],
      activities,
    };

    const report = await renderWorkReport(data);
    expect(report.subarray(0, 5).toString()).toBe("%PDF-");

    const merged = await appendPdfAttachments(report, [
      { id: "i2", label: "Anexo 1 · nf-porcelanato.pdf", buffer: await fakePdf(2) },
    ]);
    const document = await PDFDocument.load(merged.pdf);
    const reportPages = (await PDFDocument.load(report)).getPageCount();
    expect(reportPages).toBeGreaterThanOrEqual(2);
    expect(document.getPageCount()).toBe(reportPages + 2);

    // DUMP_PDF=<pasta> salva o resultado para inspeção visual manual.
    if (process.env.DUMP_PDF) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(`${process.env.DUMP_PDF}/relatorio-obra-teste.pdf`, merged.pdf);
    }
  }, 60_000);

  it("gera o relatório mesmo sem itens, fotos ou documentos", async () => {
    const report = await renderWorkReport({
      branding,
      work: { ...work, status: "planejada", notes: null },
      totals: { servicesTotal: 0, materialsTotal: 0, otherTotal: 0, grandTotal: 0, paidTotal: 0, unpaidTotal: 0 },
      entries: [],
      photos: [],
      invoices: [],
      activities: [],
    });
    expect(report.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("renderWorksListReport", () => {
  it("gera o relatório geral com totais pago/a pagar", async () => {
    const report = await renderWorksListReport({
      branding,
      periodLabel: "Todo o histórico",
      filters: ["Somente obras ativas"],
      rows: [
        { code: "OBR-2026-0001", title: "Pintura sala", propertyLabel: "Casa 12", status: "concluida", startedAt: "2026-02-01", totalAmount: 1200, paidAmount: 1200 },
        { code: "OBR-2026-0002", title: "Telhado", propertyLabel: "Sobrado 4", status: "em_andamento", startedAt: null, totalAmount: 5400, paidAmount: 2000 },
      ],
    });
    expect(report.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
