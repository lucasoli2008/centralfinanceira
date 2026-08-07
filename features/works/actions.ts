"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAppContext } from "@/lib/auth/session";
import { buildAuditMetadata } from "@/features/entries/actions";
import {
  archiveWorkSchema,
  workAttachmentSchema,
  workEntrySchema,
  workSchema,
  type WorkEntryFormValues,
  type WorkFormValues,
} from "@/lib/validation/work";
import { logServerError, toUserMessage } from "@/lib/errors";
import type { ActionResult } from "@/lib/action-result";

const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;

function revalidateWorkPaths(workId?: string) {
  revalidatePath("/obras");
  revalidatePath("/obras/lista");
  revalidatePath("/obras/relatorios");
  if (workId) revalidatePath(`/obras/${workId}`);
}

function fieldErrorsFromZod(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".");
    if (!fieldErrors[path]) fieldErrors[path] = issue.message;
  }
  return fieldErrors;
}

export async function saveWork(
  values: WorkFormValues,
  workId?: string,
): Promise<ActionResult<{ workId: string }>> {
  await requireAppContext();

  const parsed = workSchema.safeParse(values);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Revise os valores informados.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const work = parsed.data;
  const supabase = await createSupabaseServerClient();
  const metadata = await buildAuditMetadata();

  const payload = {
    title: work.title,
    property_label: work.propertyLabel,
    address: work.address,
    owner_label: work.ownerLabel,
    responsible_name: work.responsibleName,
    description: work.description,
    status: work.status,
    category: work.category,
    priority: work.priority,
    requested_at: work.requestedAt ?? null,
    started_at: work.startedAt ?? null,
    expected_at: work.expectedAt ?? null,
    completed_at: work.completedAt ?? null,
    notes: work.notes ?? null,
  };

  const { data, error } = await supabase.rpc("app_save_work", {
    p_payload: payload,
    p_work_id: workId ?? null,
    p_metadata: metadata,
  });

  if (error) {
    logServerError("works.saveWork", error);
    return { status: "error", message: toUserMessage(error) };
  }

  revalidateWorkPaths(workId ?? (data as string));
  return { status: "ok", data: { workId: data as string } };
}

export async function archiveWork(workId: string, reason?: string): Promise<ActionResult> {
  await requireAppContext();

  const parsed = archiveWorkSchema.safeParse({ reason: reason ?? null });
  if (!parsed.success) {
    return { status: "error", message: "Justificativa inválida." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("app_archive_work", {
    p_work_id: workId,
    p_reason: parsed.data.reason ?? null,
    p_metadata: await buildAuditMetadata(),
  });

  if (error) {
    logServerError("works.archiveWork", error);
    return { status: "error", message: toUserMessage(error) };
  }

  revalidateWorkPaths(workId);
  return { status: "ok" };
}

export async function unarchiveWork(workId: string): Promise<ActionResult> {
  await requireAppContext();

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("app_unarchive_work", {
    p_work_id: workId,
    p_metadata: await buildAuditMetadata(),
  });

  if (error) {
    logServerError("works.unarchiveWork", error);
    return { status: "error", message: toUserMessage(error) };
  }

  revalidateWorkPaths(workId);
  return { status: "ok" };
}

export async function saveWorkEntry(
  values: WorkEntryFormValues,
  entryId?: string,
): Promise<ActionResult<{ entryId: string }>> {
  await requireAppContext();

  const parsed = workEntrySchema.safeParse(values);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Revise os valores informados.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const entry = parsed.data;
  const supabase = await createSupabaseServerClient();

  const payload = {
    work_id: entry.workId,
    entry_type: entry.entryType,
    entry_date: entry.entryDate,
    description: entry.description,
    category: entry.category ?? null,
    supplier_name: entry.supplierName ?? null,
    quantity: entry.quantity,
    unit: entry.unit,
    unit_price: entry.unitPrice,
    total_amount: entry.totalAmount,
    total_is_manual: entry.totalIsManual,
    notes: entry.notes ?? null,
  };

  const { data, error } = await supabase.rpc("app_save_work_entry", {
    p_payload: payload,
    p_work_entry_id: entryId ?? null,
    p_metadata: await buildAuditMetadata(),
  });

  if (error) {
    logServerError("works.saveWorkEntry", error);
    return { status: "error", message: toUserMessage(error) };
  }

  revalidateWorkPaths(entry.workId);
  return { status: "ok", data: { entryId: data as string } };
}

export async function deleteWorkEntry(entryId: string, workId: string): Promise<ActionResult> {
  await requireAppContext();

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("app_delete_work_entry", {
    p_work_entry_id: entryId,
    p_metadata: await buildAuditMetadata(),
  });

  if (error) {
    logServerError("works.deleteWorkEntry", error);
    return { status: "error", message: toUserMessage(error) };
  }

  revalidateWorkPaths(workId);
  return { status: "ok" };
}

/** Nome seguro para o caminho no Storage — nunca o nome original cru. */
function sanitizeForStoragePath(fileName: string): string {
  const cleaned = fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
  return cleaned.slice(-120) || "arquivo";
}

export async function uploadWorkAttachment(formData: FormData): Promise<ActionResult<{ attachmentId: string }>> {
  const context = await requireAppContext();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Selecione um arquivo para enviar." };
  }

  const parsed = workAttachmentSchema.safeParse({
    workId: formData.get("workId"),
    workEntryId: formData.get("workEntryId") || null,
    category: formData.get("category"),
    description: formData.get("description") || null,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Revise os dados do anexo.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return { status: "error", message: "Formato não suportado. Envie PDF, JPG, PNG ou WEBP." };
  }

  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    return { status: "error", message: "Arquivo muito grande (máx. 10 MB)." };
  }

  const attachment = parsed.data;
  const supabase = await createSupabaseServerClient();
  const attachmentId = randomUUID();
  const storagePath = `${context.organization.id}/${attachment.workId}/${attachmentId}-${sanitizeForStoragePath(file.name)}`;

  const { error: uploadError } = await supabase.storage
    .from("work-attachments")
    .upload(storagePath, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    logServerError("works.uploadWorkAttachment.storage", uploadError);
    return { status: "error", message: "Não foi possível enviar o arquivo. Tente novamente." };
  }

  const { data, error } = await supabase.rpc("app_register_work_attachment", {
    p_payload: {
      work_id: attachment.workId,
      work_entry_id: attachment.workEntryId ?? null,
      category: attachment.category,
      storage_path: storagePath,
      file_name: file.name.slice(0, 200),
      mime_type: file.type,
      file_size_bytes: file.size,
      description: attachment.description ?? null,
    },
    p_metadata: await buildAuditMetadata(),
  });

  if (error) {
    logServerError("works.uploadWorkAttachment.register", error);
    await supabase.storage.from("work-attachments").remove([storagePath]);
    return { status: "error", message: toUserMessage(error) };
  }

  revalidateWorkPaths(attachment.workId);
  return { status: "ok", data: { attachmentId: data as string } };
}

export async function deleteWorkAttachment(attachmentId: string, workId: string): Promise<ActionResult> {
  await requireAppContext();

  const supabase = await createSupabaseServerClient();
  const { data: storagePath, error } = await supabase.rpc("app_delete_work_attachment", {
    p_attachment_id: attachmentId,
    p_metadata: await buildAuditMetadata(),
  });

  if (error) {
    logServerError("works.deleteWorkAttachment", error);
    return { status: "error", message: toUserMessage(error) };
  }

  if (storagePath) {
    const { error: removeError } = await supabase.storage.from("work-attachments").remove([storagePath as string]);
    if (removeError) {
      logServerError("works.deleteWorkAttachment.storage", removeError);
      // O registro já foi removido; um objeto órfão no bucket não impede o uso do sistema.
    }
  }

  revalidateWorkPaths(workId);
  return { status: "ok" };
}
