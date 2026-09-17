"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Camera, FileText, ImageIcon, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormField, NativeSelect, Textarea } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { uploadWorkAttachment } from "./actions";
import { ATTACHMENT_ACCEPT, describeFileSize, isPhotoCategory, validateAttachmentFile } from "./attachment-files";
import { WORK_ATTACHMENT_CATEGORY_LABELS } from "@/lib/formatting/labels";
import { cn } from "@/lib/utils";
import type { WorkAttachmentCategory, WorkEntryRow } from "@/types/database";

interface WorkAttachmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workId: string;
  categories: WorkAttachmentCategory[];
  defaultCategory: WorkAttachmentCategory;
  entries?: WorkEntryRow[];
  title: string;
  description: string;
}

export function WorkAttachmentDialog({
  open,
  onOpenChange,
  workId,
  categories,
  defaultCategory,
  entries,
  title,
  description,
}: WorkAttachmentDialogProps) {
  const router = useRouter();
  const [files, setFiles] = React.useState<File[]>([]);
  const [category, setCategory] = React.useState<WorkAttachmentCategory>(defaultCategory);
  const [entryId, setEntryId] = React.useState("");
  const [note, setNote] = React.useState("");
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const cameraInputRef = React.useRef<HTMLInputElement>(null);

  const photoMode = isPhotoCategory(category);
  const pending = progress !== null;

  function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    setError(null);
    const accepted: File[] = [];
    for (const file of Array.from(list)) {
      const problem = validateAttachmentFile(file);
      if (problem) {
        toast.error(`${file.name}: ${problem}`);
        continue;
      }
      accepted.push(file);
    }
    setFiles((current) => [...current, ...accepted]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (files.length === 0) {
      setError("Selecione pelo menos um arquivo.");
      return;
    }

    setProgress({ done: 0, total: files.length });
    let uploaded = 0;
    const failures: string[] = [];

    for (const [index, file] of files.entries()) {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("workId", workId);
      formData.set("category", category);
      if (entryId) formData.set("workEntryId", entryId);
      if (note.trim()) formData.set("description", note.trim());

      const result = await uploadWorkAttachment(formData);
      if (result.status === "ok") uploaded += 1;
      else failures.push(`${file.name}: ${result.message}`);
      setProgress({ done: index + 1, total: files.length });
    }

    setProgress(null);

    if (uploaded > 0) {
      toast.success(uploaded === 1 ? "Arquivo enviado." : `${uploaded} arquivos enviados.`);
    }
    for (const failure of failures) toast.error(failure);

    if (failures.length === 0) {
      onOpenChange(false);
      router.refresh();
    } else {
      setFiles((current) => current.filter((file) => failures.some((failure) => failure.startsWith(`${file.name}:`))));
      router.refresh();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div
            className={cn(
              "rounded-control border border-dashed px-4 py-6 text-center transition-colors",
              dragging ? "border-accent bg-accent-soft" : "border-border-strong bg-surface-sunken",
            )}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              addFiles(event.dataTransfer.files);
            }}
          >
            <Upload className="mx-auto size-5 text-subtle" />
            <p className="mt-2 text-[13px]">
              Arraste os arquivos aqui ou{" "}
              <button
                type="button"
                className="font-medium text-accent hover:underline"
                onClick={() => fileInputRef.current?.click()}
              >
                escolha no dispositivo
              </button>
            </p>
            <p className="mt-1 text-[12px] text-subtle">
              {photoMode ? "JPG, PNG ou WEBP" : "PDF, JPG, PNG ou WEBP"} — até 10 MB cada. Pode selecionar vários.
            </p>
            {photoMode ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-3 sm:hidden"
                onClick={() => cameraInputRef.current?.click()}
              >
                <Camera />
                Tirar foto agora
              </Button>
            ) : null}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={photoMode ? ".jpg,.jpeg,.png,.webp" : ATTACHMENT_ACCEPT}
              className="sr-only"
              onChange={(event) => addFiles(event.target.files)}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(event) => addFiles(event.target.files)}
            />
          </div>

          {files.length > 0 ? (
            <ul className="max-h-40 space-y-1.5 overflow-y-auto">
              {files.map((file, index) => (
                <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 text-[12.5px]">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {file.type.startsWith("image/") ? (
                      <ImageIcon className="size-3.5 shrink-0 text-subtle" />
                    ) : (
                      <FileText className="size-3.5 shrink-0 text-subtle" />
                    )}
                    <span className="truncate">{file.name}</span>
                    <span className="shrink-0 text-subtle">· {describeFileSize(file.size)}</span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={pending}
                    aria-label={`Descartar ${file.name}`}
                    onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Categoria" htmlFor="attachment-category" required>
              <NativeSelect
                id="attachment-category"
                value={category}
                onChange={(event) => setCategory(event.target.value as WorkAttachmentCategory)}
              >
                {categories.map((option) => (
                  <option key={option} value={option}>
                    {WORK_ATTACHMENT_CATEGORY_LABELS[option]}
                  </option>
                ))}
              </NativeSelect>
            </FormField>

            {entries && entries.length > 0 ? (
              <FormField label="Vincular a um item" htmlFor="attachment-entry" hint="Opcional.">
                <NativeSelect
                  id="attachment-entry"
                  value={entryId}
                  onChange={(event) => setEntryId(event.target.value)}
                >
                  <option value="">Nenhum</option>
                  {entries.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.description}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
            ) : null}
          </div>

          <FormField
            label={photoMode ? "Legenda" : "Descrição"}
            htmlFor="attachment-description"
            hint={photoMode ? "Opcional. Aparece sob a foto no relatório." : "Opcional."}
          >
            <Textarea
              id="attachment-description"
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={200}
            />
          </FormField>

          {error ? <p className="text-[13px] text-danger">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || files.length === 0}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {pending
                ? `Enviando ${progress.done} de ${progress.total}…`
                : files.length > 1
                  ? `Enviar ${files.length} arquivos`
                  : "Enviar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
