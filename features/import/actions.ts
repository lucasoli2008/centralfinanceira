"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAppContext } from "@/lib/auth/session";
import { listBrokers } from "@/server/queries/brokers";
import { parseSpreadsheet, type ImportPreview } from "@/server/import/parse-spreadsheet";
import { entrySchema } from "@/lib/validation/entry";
import { logServerError, toUserMessage } from "@/lib/errors";
import { buildAuditMetadata, type ActionResult } from "@/features/entries/actions";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = [".xlsx", ".xlsm"];

const previewOptionsSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  dayOfMonth: z.coerce.number().int().min(1).max(28).default(1),
  entryType: z.enum(["sale", "rental"]).default("sale"),
});

/** Etapa 1 — lê o arquivo e devolve a prévia, sem gravar nada. */
export async function previewImport(formData: FormData): Promise<ActionResult<ImportPreview>> {
  await requireAppContext();

  const file = formData.get("arquivo");

  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Selecione a planilha que deseja importar." };
  }

  if (file.size > MAX_FILE_BYTES) {
    return {
      status: "error",
      message: "O arquivo excede 8 MB. Envie a planilha original, sem imagens adicionais.",
    };
  }

  const lowerName = file.name.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((extension) => lowerName.endsWith(extension))) {
    return { status: "error", message: "Formato não suportado. Envie um arquivo .xlsx." };
  }

  const options = previewOptionsSchema.safeParse({
    year: formData.get("ano"),
    dayOfMonth: formData.get("dia"),
    entryType: formData.get("tipo"),
  });

  if (!options.success) {
    return { status: "error", message: "Revise o ano e o tipo de entrada da importação." };
  }

  try {
    const brokers = await listBrokers({ includeInactive: true });

    const preview = await parseSpreadsheet(await file.arrayBuffer(), {
      filename: file.name,
      year: options.data.year,
      dayOfMonth: options.data.dayOfMonth,
      entryType: options.data.entryType,
      existingBrokers: brokers.map((broker) => ({ id: broker.id, full_name: broker.full_name })),
    });

    if (preview.rows.length === 0) {
      return {
        status: "error",
        message:
          "Nenhum lançamento pôde ser lido nesta planilha. Confira se as abas mensais têm a coluna de valor e a descrição do imóvel.",
      };
    }

    return { status: "ok", data: preview };
  } catch (error) {
    logServerError("import.previewImport", error);
    return {
      status: "error",
      message: "Não foi possível ler a planilha. Verifique se o arquivo não está corrompido.",
    };
  }
}

const confirmSchema = z.object({
  filename: z.string().max(200),
  year: z.number().int().min(2000).max(2100),
  entryType: z.enum(["sale", "rental"]),
  brokers: z.array(
    z.object({
      key: z.string(),
      name: z.string().trim().min(1),
      existingBrokerId: z.uuid().nullable(),
      /** false quando o administrador optou por importar sem o corretor. */
      include: z.boolean().default(true),
    }),
  ),
  rows: z.array(
    z.object({
      id: z.string(),
      entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      description: z.string().trim().min(1),
      reference: z.string().nullable(),
      propertyType: z.enum(["residential", "commercial"]),
      baseAmount: z.number().positive(),
      commissionRate: z.number().min(0).max(100).nullable(),
      brokerKey: z.string().nullable(),
      splitRate: z.number().min(0).max(100).nullable(),
    }),
  ),
});

export type ConfirmImportInput = z.input<typeof confirmSchema>;

/**
 * Etapa 2 — cria os corretores que faltam e importa tudo em uma única
 * transação no banco (app_import_entries). Se qualquer linha falhar, nada é
 * gravado.
 */
export async function confirmImport(
  input: ConfirmImportInput,
): Promise<ActionResult<{ importId: string; entriesCount: number }>> {
  await requireAppContext();

  const parsed = confirmSchema.safeParse(input);

  if (!parsed.success) {
    return {
      status: "error",
      message: "A prévia da importação está inconsistente. Leia a planilha novamente.",
    };
  }

  const { filename, year, entryType, brokers, rows } = parsed.data;
  const supabase = await createSupabaseServerClient();
  const metadata = await buildAuditMetadata({ arquivo: filename, ano: String(year) });

  // 1. Corretores que ainda não existem no cadastro.
  const brokerIdByKey = new Map<string, string>();

  for (const broker of brokers) {
    if (!broker.include) continue;

    if (broker.existingBrokerId) {
      brokerIdByKey.set(broker.key, broker.existingBrokerId);
      continue;
    }

    const { data, error } = await supabase.rpc("app_save_broker", {
      p_payload: {
        full_name: broker.name,
        default_split_mode: "percentage",
        is_active: true,
        confirm_duplicate_name: true,
      },
      p_broker_id: null,
      p_metadata: metadata,
    });

    if (error) {
      logServerError("import.confirmImport.broker", error);
      return { status: "error", message: toUserMessage(error) };
    }

    brokerIdByKey.set(broker.key, data as string);
  }

  // 2. Validação de cada linha com as mesmas regras do formulário.
  const entries = rows.map((row) => {
    const brokerId = row.brokerKey ? brokerIdByKey.get(row.brokerKey) : undefined;
    const hasSplit = Boolean(brokerId) && row.splitRate !== null;

    return {
      entry_type: entryType,
      entry_date: row.entryDate,
      description: row.description,
      reference: row.reference,
      property_type: row.propertyType,
      base_amount: row.baseAmount,
      commission_mode: "percentage" as const,
      commission_rate: row.commissionRate ?? 0,
      commission_fixed_amount: null,
      notes: `Importado de ${filename}`,
      splits: hasSplit
        ? [{ broker_id: brokerId, split_mode: "percentage" as const, split_rate: row.splitRate }]
        : [],
    };
  });

  for (const entry of entries) {
    const validation = entrySchema.safeParse({
      entryType: entry.entry_type,
      entryDate: entry.entry_date,
      description: entry.description,
      reference: entry.reference,
      propertyType: entry.property_type,
      baseAmount: entry.base_amount,
      commissionMode: "percentage",
      commissionRate: entry.commission_rate,
      commissionFixedAmount: null,
      notes: entry.notes,
      splits: entry.splits.map((split) => ({
        brokerId: split.broker_id as string,
        splitMode: "percentage" as const,
        splitRate: split.split_rate,
        splitFixedAmount: null,
      })),
      exceptionConfirmed: false,
      exceptionReason: null,
    });

    if (!validation.success) {
      return {
        status: "error",
        message: `Linha "${entry.description}": ${validation.error.issues[0]?.message ?? "dados inválidos"}`,
      };
    }
  }

  // 3. Importação transacional.
  const { data, error } = await supabase.rpc("app_import_entries", {
    p_payload: {
      source_filename: filename,
      metadata: { ano: year, tipo: entryType, linhas: entries.length },
      entries,
    },
    p_metadata: metadata,
  });

  if (error) {
    logServerError("import.confirmImport", error);
    return { status: "error", message: toUserMessage(error) };
  }

  const result = data as { import_id: string; entries_count: number };

  revalidatePath("/importar");
  revalidatePath("/dashboard");
  revalidatePath("/vendas");
  revalidatePath("/locacoes");
  revalidatePath("/meses");
  revalidatePath("/corretores");
  revalidatePath("/auditoria");

  return {
    status: "ok",
    data: { importId: result.import_id, entriesCount: result.entries_count },
  };
}

/** Desfaz a importação inteira, desde que os meses estejam abertos. */
export async function undoImport(importId: string): Promise<ActionResult<{ undone: number }>> {
  await requireAppContext();

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("app_undo_import", {
    p_import_id: importId,
    p_metadata: await buildAuditMetadata(),
  });

  if (error) {
    logServerError("import.undoImport", error);
    return { status: "error", message: toUserMessage(error) };
  }

  revalidatePath("/importar");
  revalidatePath("/dashboard");
  revalidatePath("/vendas");
  revalidatePath("/locacoes");
  revalidatePath("/meses");

  return { status: "ok", data: { undone: data as number } };
}
