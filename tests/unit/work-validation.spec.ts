import { describe, expect, it } from "vitest";
import { workEntrySchema, workSchema } from "@/lib/validation/work";

const validWork = {
  title: "Reforma banheiro social",
  propertyLabel: "Apto 302 — Edifício Aurora",
  address: "Rua das Palmeiras, 123",
  ownerLabel: "Maria Souza",
  responsibleName: "João Corretor",
  description: "Troca de revestimento e louças do banheiro social.",
  status: "planejada" as const,
  category: "reforma" as const,
  priority: "normal" as const,
};

describe("workSchema", () => {
  it("aceita uma obra válida sem datas", () => {
    const result = workSchema.safeParse(validWork);
    expect(result.success).toBe(true);
  });

  it("rejeita conclusão anterior ao início", () => {
    const result = workSchema.safeParse({
      ...validWork,
      startedAt: "2026-03-10",
      completedAt: "2026-03-01",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((item) => item.path.join(".") === "completedAt");
      expect(issue?.message).toContain("não pode ser anterior");
    }
  });

  it("aceita conclusão na mesma data do início", () => {
    const result = workSchema.safeParse({
      ...validWork,
      startedAt: "2026-03-10",
      completedAt: "2026-03-10",
    });
    expect(result.success).toBe(true);
  });

  it("rejeita título vazio", () => {
    const result = workSchema.safeParse({ ...validWork, title: "   " });
    expect(result.success).toBe(false);
  });
});

const validEntry = {
  workId: "9f3b6b0e-2c1a-4a3e-9c9a-1a2b3c4d5e6f",
  entryType: "material" as const,
  entryDate: "2026-03-05",
  description: "Porcelanato 60x60",
  quantity: 12.5,
  unit: "m2" as const,
  unitPrice: 79.9,
  totalAmount: 998.75,
  totalIsManual: false,
};

describe("workEntrySchema", () => {
  it("aceita um lançamento válido", () => {
    expect(workEntrySchema.safeParse(validEntry).success).toBe(true);
  });

  it("rejeita quantidade zero ou negativa", () => {
    expect(workEntrySchema.safeParse({ ...validEntry, quantity: 0 }).success).toBe(false);
    expect(workEntrySchema.safeParse({ ...validEntry, quantity: -1 }).success).toBe(false);
  });

  it("rejeita valor unitário com mais de duas casas decimais", () => {
    expect(workEntrySchema.safeParse({ ...validEntry, unitPrice: 79.999 }).success).toBe(false);
  });

  it("rejeita valor unitário negativo", () => {
    expect(workEntrySchema.safeParse({ ...validEntry, unitPrice: -10 }).success).toBe(false);
  });
});
