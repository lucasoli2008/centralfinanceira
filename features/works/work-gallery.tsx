"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ImageOff, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { WorkAttachmentDialog } from "./work-attachment-dialog";
import { deleteWorkAttachment } from "./actions";
import type { WorkAttachmentWithUrl } from "@/lib/works/types";
import type { WorkAttachmentCategory } from "@/types/database";

const GROUPS: { category: WorkAttachmentCategory; label: string }[] = [
  { category: "foto_antes", label: "Antes" },
  { category: "foto_durante", label: "Durante" },
  { category: "foto_depois", label: "Depois" },
];

export function WorkGallery({
  workId,
  photos,
}: {
  workId: string;
  photos: WorkAttachmentWithUrl[];
}) {
  const router = useRouter();
  const [uploadCategory, setUploadCategory] = React.useState<WorkAttachmentCategory | null>(null);
  const [preview, setPreview] = React.useState<WorkAttachmentWithUrl | null>(null);
  const [deleting, setDeleting] = React.useState<WorkAttachmentWithUrl | null>(null);
  const [pending, setPending] = React.useState(false);

  async function confirmDelete() {
    if (!deleting) return;
    setPending(true);
    const result = await deleteWorkAttachment(deleting.id, workId);
    setPending(false);

    if (result.status === "error") {
      toast.error(result.message);
      return;
    }

    toast.success("Foto removida.");
    setDeleting(null);
    setPreview(null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {GROUPS.map((group) => {
        const groupPhotos = photos.filter((photo) => photo.category === group.category);

        return (
          <div key={group.category}>
            <div className="mb-2.5 flex items-center justify-between">
              <h3 className="text-[13px] font-semibold">{group.label}</h3>
              <Button size="sm" variant="secondary" onClick={() => setUploadCategory(group.category)}>
                <Plus />
                Adicionar foto
              </Button>
            </div>

            {groupPhotos.length === 0 ? (
              <p className="text-[12.5px] text-subtle">Nenhuma foto nesta etapa.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
                {groupPhotos.map((photo) =>
                  photo.url ? (
                    <button
                      key={photo.id}
                      type="button"
                      onClick={() => setPreview(photo)}
                      className="group relative aspect-square overflow-hidden rounded-control border border-border"
                    >
                      <Image
                        src={photo.url}
                        alt={photo.description ?? photo.file_name}
                        fill
                        unoptimized
                        className="object-cover transition-transform group-hover:scale-105"
                      />
                    </button>
                  ) : (
                    <div
                      key={photo.id}
                      className="flex aspect-square items-center justify-center rounded-control border border-dashed border-border bg-surface-sunken text-subtle"
                    >
                      <ImageOff className="size-5" />
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        );
      })}

      {uploadCategory ? (
        <WorkAttachmentDialog
          open
          onOpenChange={(open) => !open && setUploadCategory(null)}
          workId={workId}
          categories={[uploadCategory]}
          defaultCategory={uploadCategory}
          title="Adicionar foto"
          description="Envie uma foto de documentação da obra (antes, durante ou depois)."
        />
      ) : null}

      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          {preview?.url ? (
            <div className="relative h-[60vh] w-full overflow-hidden rounded-control">
              <Image
                src={preview.url}
                alt={preview.description ?? preview.file_name}
                fill
                unoptimized
                className="object-contain"
              />
            </div>
          ) : null}
          <div className="flex items-center justify-between pt-2">
            <p className="text-[12.5px] text-muted">{preview?.file_name}</p>
            <Button
              variant="danger"
              size="sm"
              disabled={pending}
              onClick={() => preview && setDeleting(preview)}
            >
              <Trash2 />
              Remover foto
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <p className="text-[14px] font-medium">Remover esta foto?</p>
          <p className="mt-1 text-[13px] text-muted">
            A foto sai da galeria e do relatório desta obra.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={pending}>
              Remover
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
