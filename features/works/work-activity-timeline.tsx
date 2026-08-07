import type * as React from "react";
import {
  CheckCircle2,
  FilePlus2,
  FileText,
  ImagePlus,
  MinusCircle,
  PackagePlus,
  PlusCircle,
  Archive,
} from "lucide-react";
import { formatDateTime } from "@/lib/formatting/date";
import type { WorkActivityAction, WorkActivityRow } from "@/types/database";

const ACTIVITY_ICONS: Record<WorkActivityAction, React.ComponentType<{ className?: string }>> = {
  obra_criada: PlusCircle,
  status_alterado: FileText,
  item_adicionado: PackagePlus,
  item_removido: MinusCircle,
  documento_enviado: FilePlus2,
  foto_adicionada: ImagePlus,
  obra_concluida: CheckCircle2,
  obra_arquivada: Archive,
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
