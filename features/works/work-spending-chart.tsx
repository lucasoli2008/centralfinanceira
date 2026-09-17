"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompactCurrency, formatCurrency } from "@/lib/formatting/number";
import { monthShortName } from "@/lib/formatting/date";
import type { WorkMonthlySpending } from "@/server/queries/works";

const AXIS_TICK = { fontSize: 10.5, fill: "var(--foreground-subtle)" } as const;

function toPoints(series: WorkMonthlySpending[]) {
  return series.map((row) => {
    const [year, month] = row.periodKey.split("-").map(Number);
    return {
      label: `${monthShortName(month)} ${String(year).slice(2)}`,
      pago: row.paid,
      aPagar: Math.max(0, Math.round((row.total - row.paid) * 100) / 100),
      total: row.total,
    };
  });
}

function SpendingTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string; payload?: { total: number } }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const total = payload[0]?.payload?.total ?? 0;

  return (
    <div className="min-w-44 overflow-hidden rounded-control border border-border bg-surface shadow-popover">
      <p className="border-b border-border bg-surface-sunken px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-subtle">
        {label}
      </p>
      <ul className="space-y-1 px-2.5 py-2">
        {payload.map((item) => (
          <li key={item.name} className="flex items-center justify-between gap-4 text-[12px]">
            <span className="flex items-center gap-1.5 text-muted">
              <span className="inline-block size-1.5 rounded-full" style={{ backgroundColor: item.color }} />
              {item.name}
            </span>
            <span className="font-semibold tabular">{formatCurrency(item.value ?? 0)}</span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-4 border-t border-border pt-1 text-[12px]">
          <span className="text-muted">Total</span>
          <span className="font-semibold tabular">{formatCurrency(total)}</span>
        </li>
      </ul>
    </div>
  );
}

export function WorkSpendingChart({ series }: { series: WorkMonthlySpending[] }) {
  const data = toPoints(series);
  const totalPaid = series.reduce((sum, row) => sum + row.paid, 0);
  const totalAll = series.reduce((sum, row) => sum + row.total, 0);

  return (
    <div>
      <ul className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px]">
        <li className="flex items-baseline gap-1.5">
          <span aria-hidden="true" className="inline-block h-[3px] w-3.5 self-center rounded-full bg-accent" />
          <span className="text-muted">Pago</span>
          <span className="font-semibold tabular">{formatCurrency(totalPaid)}</span>
        </li>
        <li className="flex items-baseline gap-1.5">
          <span aria-hidden="true" className="inline-block h-[3px] w-3.5 self-center rounded-full bg-warning" />
          <span className="text-muted">A pagar</span>
          <span className="font-semibold tabular">{formatCurrency(Math.max(0, totalAll - totalPaid))}</span>
        </li>
      </ul>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="2 5" vertical={false} />
          <XAxis
            dataKey="label"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={14}
            dy={4}
          />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={60}
            tickCount={5}
            tickFormatter={(value: number) => formatCompactCurrency(value)}
          />
          <Tooltip content={<SpendingTooltip />} cursor={{ fill: "var(--surface-muted)", radius: 4 }} />
          <Bar dataKey="pago" name="Pago" stackId="gasto" fill="var(--accent)" maxBarSize={26} animationDuration={620} />
          <Bar
            dataKey="aPagar"
            name="A pagar"
            stackId="gasto"
            fill="var(--warning)"
            radius={[4, 4, 0, 0]}
            maxBarSize={26}
            animationDuration={620}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
