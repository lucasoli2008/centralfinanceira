import type * as React from "react";
import {
  Archive,
  ArchiveRestore,
  BadgeDollarSign,
  CheckCircle2,
  FilePlus2,
  FileText,
  ImagePlus,
  MinusCircle,
  PackagePlus,
  Pencil,
  PlusCircle,
  Trash2,
} from "lucide-react";
import { formatDateTime } from "@/lib/formatting/date";
import type { WorkActivityAction, WorkActivityRow } from "@/types/database";

const ACTIVITY_ICONS: Record<WorkActivityAction, React.ComponentType<{ className?: string }>> = {
  obra_criada: PlusCircle,
  status_alterado: FileText,
  item_adicionado: PackagePlus,
  item_editado: Pencil,
  item_removido: MinusCircle,
  item_pago: BadgeDollarSign,
  documento_enviado: FilePlus2,
  foto_adicionada: ImagePlus,
  anexo_removido: Trash2,
  obra_concluida: CheckCircle2,
  obra_arquivada: Archive,
  obra_reaberta: ArchiveRestore,
};

export function WorkActivityTimeline({ activities }: { activities: WorkActivityRow[] }) {
  if (activities.length === 0) {
    return <p className="text-[13px] text-muted">Nenhuma atividade registrada ainda.</p>;
  }

  return (
    <ol className="space-y-4">
      {activities.map((activity) => {
        const Icon = ACTIVITY_ICONS[activity.action] ?? FileText;
        return (
          <li key={activity.id} className="flex gap-3">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0">
              <p className="text-[13px]">{activity.description}</p>
              <p className="mt-0.5 text-xs text-subtle">{formatDateTime(activity.created_at)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
