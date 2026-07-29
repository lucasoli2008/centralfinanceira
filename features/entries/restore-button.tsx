"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { restoreEntry } from "./actions";

export function RestoreEntryButton({ entryId }: { entryId: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        const result = await restoreEntry(entryId);
        setPending(false);

        if (result.status === "error") {
          toast.error(result.message);
          return;
        }

        toast.success("Lançamento restaurado.");
        router.refresh();
      }}
    >
      <RotateCcw />
      Restaurar
    </Button>
  );
}
