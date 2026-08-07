"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormField, Input, NativeSelect, Textarea } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { uploadWorkAttachment } from "./actions";
import { WORK_ATTACHMENT_CATEGORY_LABELS } from "@/lib/formatting/labels";
import type { WorkAttachmentCategory } from "@/types/database";
import type { WorkEntryRow } from "@/types/database";

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp";

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
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);
    if (!(formData.get("file") instanceof File) || (formData.get("file") as File).size === 0) {
      setError("Selecione um arquivo para enviar.");
      return;
    }
    formData.set("workId", workId);

    setPending(true);
    const result = await uploadWorkAttachment(formData);
    setPending(false);

    if (result.status === "error") {
      setError(result.message);
      return;
    }

    toast.success("Arquivo enviado.");
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField
            label="Arquivo"
            htmlFor="attachment-file"
            required
            hint="PDF, JPG, PNG ou WEBP — até 10 MB."
          >
            <Input id="attachment-file" name="file" type="file" accept={ACCEPT} required />
          </FormField>

          <FormField label="Categoria" htmlFor="attachment-category" required>
            <NativeSelect id="attachment-category" name="category" defaultValue={defaultCategory}>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {WORK_ATTACHMENT_CATEGORY_LABELS[category]}
                </option>
              ))}
            </NativeSelect>
          </FormField>

          {entries && entries.length > 0 ? (
            <FormField
              label="Vincular a um item de custo"
              htmlFor="attachment-entry"
              hint="Opcional. Associa este documento a um material, serviço ou custo já lançado."
            >
              <NativeSelect id="attachment-entry" name="workEntryId" defaultValue="">
                <option value="">Nenhum</option>
                {entries.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.description}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          ) : null}

          <FormField label="Descrição" htmlFor="attachment-description" hint="Opcional.">
            <Textarea id="attachment-description" name="description" rows={2} />
          </FormField>

          {error ? <p className="text-[13px] text-danger">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Enviar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
