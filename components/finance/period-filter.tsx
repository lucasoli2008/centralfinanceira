"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { NativeSelect, Input } from "@/components/ui/field";
import { PERIOD_PRESET_LABELS, PERIOD_PRESETS, type PeriodPreset } from "@/lib/period";
import { MONTH_NAMES } from "@/lib/formatting/date";

const STORAGE_KEY = "central-financeira:periodo";

/**
 * Filtro global de período. Reflete-se na URL (compartilhável) e memoriza a
 * última escolha do usuário.
 */
export function PeriodFilter({ years }: { years: number[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const preset = (searchParams.get("periodo") ?? "este-mes") as PeriodPreset;
  const currentYear = new Date().getFullYear();

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
        // Sem localStorage disponível: o filtro continua funcionando pela URL.
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
      <div className="relative">
        <CalendarRange className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
        <NativeSelect
          aria-label="Período"
          className="w-auto min-w-44 pl-8"
          value={preset}
          onChange={(event) => update({ periodo: event.target.value })}
        >
          {PERIOD_PRESETS.map((option) => (
            <option key={option} value={option}>
              {PERIOD_PRESET_LABELS[option]}
            </option>
          ))}
        </NativeSelect>
      </div>

      {preset === "mes" ? (
        <>
          <NativeSelect
            aria-label="Mês"
            className="w-auto"
            value={searchParams.get("mes") ?? String(new Date().getMonth() + 1)}
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
            className="w-auto"
            value={searchParams.get("ano") ?? String(currentYear)}
            onChange={(event) => update({ ano: event.target.value })}
          >
            {(years.length ? years : [currentYear]).map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </NativeSelect>
        </>
      ) : null}

      {preset === "personalizado" ? (
        <>
          <Input
            type="date"
            aria-label="Data inicial"
            className="w-auto"
            defaultValue={searchParams.get("de") ?? ""}
            onChange={(event) => update({ de: event.target.value })}
          />
          <span className="text-[13px] text-subtle">até</span>
          <Input
            type="date"
            aria-label="Data final"
            className="w-auto"
            defaultValue={searchParams.get("ate") ?? ""}
            onChange={(event) => update({ ate: event.target.value })}
          />
        </>
      ) : null}
    </div>
  );
}
