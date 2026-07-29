"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { CalendarRange, Check, ChevronDown } from "lucide-react";
import { Input, NativeSelect } from "@/components/ui/field";
import { Segmented, type SegmentedOption } from "@/components/ui/segmented";
import { PERIOD_PRESET_LABELS, PERIOD_PRESETS, type PeriodPreset } from "@/lib/period";
import { MONTH_NAMES } from "@/lib/formatting/date";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "central-financeira:periodo";

/** Presets que ficam sempre visíveis no controle segmentado. */
const QUICK: SegmentedOption<PeriodPreset>[] = [
  { value: "este-mes", label: "Este mês", shortLabel: "Mês" },
  { value: "mes-anterior", label: "Mês anterior", shortLabel: "Anterior" },
  { value: "ultimos-3-meses", label: "3 meses", shortLabel: "3M" },
  { value: "ultimos-6-meses", label: "6 meses", shortLabel: "6M" },
  { value: "ano-atual", label: "Ano", shortLabel: "Ano" },
];

/** Presets menos frequentes, acessíveis pelo botão "Outro período". */
const MORE: PeriodPreset[] = ["ano-anterior", "mes", "personalizado"];

/**
 * Filtro global de período.
 *
 * Reflete-se na URL (link compartilhável) e memoriza a última escolha.
 * Os presets mais usados ficam num controle segmentado; os demais em um popover,
 * junto dos campos de mês específico e de intervalo personalizado.
 */
export function PeriodFilter({ years }: { years: number[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = React.useState(false);

  const preset = (searchParams.get("periodo") ?? "este-mes") as PeriodPreset;
  const now = new Date();
  const currentYear = now.getFullYear();
  const isCustom = MORE.includes(preset);

  const update = React.useCallback(
    (changes: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === "") params.delete(key);
        else params.set(key, value);
      }
      params.delete("pagina");

      try {
        window.localStorage.setItem(STORAGE_KEY, params.get("periodo") ?? "este-mes");
      } catch {
        // Sem localStorage: o filtro continua funcionando pela URL.
      }

      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

  // Restaura o último período usado quando a URL não define nenhum.
  React.useEffect(() => {
    if (searchParams.get("periodo")) return;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored && stored !== "este-mes" && (PERIOD_PRESETS as readonly string[]).includes(stored)) {
        update({ periodo: stored });
      }
    } catch {
      // ignorado
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        ariaLabel="Período"
        options={QUICK}
        value={isCustom ? ("" as PeriodPreset) : preset}
        onChange={(next) => update({ periodo: next, de: null, ate: null })}
      />

      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-control border px-2.5 text-[12.5px] font-medium transition-colors",
              isCustom
                ? "border-accent-border bg-accent-soft text-accent"
                : "border-border-strong bg-surface text-muted hover:text-foreground",
            )}
          >
            <CalendarRange className="size-3.5" />
            <span className="hidden sm:inline">
              {isCustom ? PERIOD_PRESET_LABELS[preset] : "Outro período"}
            </span>
            <ChevronDown className="size-3.5 opacity-70" />
          </button>
        </PopoverPrimitive.Trigger>

        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align="end"
            sideOffset={6}
            className="z-50 w-72 rounded-card border border-border bg-surface p-1.5 shadow-popover"
          >
            <p className="label-overline px-2 pb-1 pt-1.5">Outros períodos</p>

            {MORE.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => update({ periodo: option })}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-control px-2 py-1.5 text-left text-[13px] transition-colors",
                  preset === option ? "bg-accent-soft text-accent" : "hover:bg-surface-muted",
                )}
              >
                {PERIOD_PRESET_LABELS[option]}
                {preset === option ? <Check className="size-3.5" /> : null}
              </button>
            ))}

            {preset === "mes" ? (
              <div className="mt-1.5 grid grid-cols-2 gap-2 border-t border-border p-2 pt-2.5">
                <NativeSelect
                  aria-label="Mês"
                  value={searchParams.get("mes") ?? String(now.getMonth() + 1)}
                  onChange={(event) => update({ mes: event.target.value })}
                >
                  {MONTH_NAMES.map((name, index) => (
                    <option key={name} value={index + 1}>
                      {name}
                    </option>
                  ))}
                </NativeSelect>
                <NativeSelect
                  aria-label="Ano"
                  value={searchParams.get("ano") ?? String(currentYear)}
                  onChange={(event) => update({ ano: event.target.value })}
                >
                  {(years.length ? years : [currentYear]).map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ) : null}

            {preset === "personalizado" ? (
              <div className="mt-1.5 space-y-2 border-t border-border p-2 pt-2.5">
                <label className="block">
                  <span className="label-caption">Data inicial</span>
                  <Input
                    type="date"
                    className="mt-1"
                    defaultValue={searchParams.get("de") ?? ""}
                    onChange={(event) => update({ de: event.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="label-caption">Data final</span>
                  <Input
                    type="date"
                    className="mt-1"
                    defaultValue={searchParams.get("ate") ?? ""}
                    onChange={(event) => update({ ate: event.target.value })}
                  />
                </label>
              </div>
            ) : null}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </div>
  );
}
