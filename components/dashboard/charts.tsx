"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCompactCurrency, formatCurrency, formatPercent } from "@/lib/formatting/number";
import { monthShortName } from "@/lib/formatting/date";
import type { MonthlySeriesRow } from "@/types/database";

const AXIS_TICK = { fontSize: 10.5, fill: "var(--foreground-subtle)" } as const;
const GRID = "var(--border)";

interface SeriesPoint {
  label: string;
  gross: number;
  payout: number;
  net: number;
  salesGross: number;
  rentalGross: number;
}

function toPoints(series: MonthlySeriesRow[]): SeriesPoint[] {
  return series.map((row) => ({
    label: `${monthShortName(row.month)} ${String(row.year).slice(2)}`,
    gross: Number(row.total_gross_commission),
    payout: Number(row.total_broker_payout),
    net: Number(row.total_net_revenue),
    salesGross: Number(row.sales_gross_commission),
    rentalGross: Number(row.rental_gross_commission),
  }));
}

/** Legenda própria: mais legível e alinhada ao design system. */
function ChartLegend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-[11.5px] text-muted">
          <span
            aria-hidden="true"
            className="inline-block h-0.5 w-3 rounded-full"
            style={
              item.dashed
                ? {
                    backgroundImage: `repeating-linear-gradient(to right, ${item.color} 0 3px, transparent 3px 5px)`,
                  }
                : { backgroundColor: item.color }
            }
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="min-w-40 rounded-control border border-border bg-surface px-2.5 py-2 shadow-popover">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">{label}</p>
      <ul className="space-y-0.5">
        {payload.map((item) => (
          <li key={item.name} className="flex items-center justify-between gap-4 text-[12px]">
            <span className="flex items-center gap-1.5 text-muted">
              <span
                className="inline-block size-1.5 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              {item.name}
            </span>
            <span className="font-semibold tabular">{formatCurrency(item.value ?? 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const yAxisProps = {
  tick: AXIS_TICK,
  tickLine: false,
  axisLine: false,
  width: 62,
  tickFormatter: (value: number) => formatCompactCurrency(value),
} as const;

const xAxisProps = {
  dataKey: "label",
  tick: AXIS_TICK,
  tickLine: false,
  axisLine: false,
  interval: "preserveStartEnd",
  minTickGap: 12,
} as const;

export function MonthlyEvolutionChart({ series }: { series: MonthlySeriesRow[] }) {
  const data = toPoints(series);

  return (
    <div>
      <ChartLegend
        items={[
          { label: "Comissão bruta", color: "var(--accent)" },
          { label: "Receita líquida", color: "var(--info)" },
          { label: "Repasses", color: "var(--warning)", dashed: true },
        ]}
      />
      <ResponsiveContainer width="100%" height={244}>
        <AreaChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="grossArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.14} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
          <XAxis {...xAxisProps} />
          <YAxis {...yAxisProps} />
          <Tooltip content={<ChartTooltip />} />
          <Area
            type="monotone"
            dataKey="gross"
            name="Comissão bruta"
            stroke="var(--accent)"
            fill="url(#grossArea)"
            strokeWidth={1.75}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
          />
          <Area
            type="monotone"
            dataKey="net"
            name="Receita líquida"
            stroke="var(--info)"
            fill="transparent"
            strokeWidth={1.75}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
          />
          <Area
            type="monotone"
            dataKey="payout"
            name="Repasses"
            stroke="var(--warning)"
            fill="transparent"
            strokeWidth={1.5}
            strokeDasharray="3 3"
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SalesVsRentalsChart({ series }: { series: MonthlySeriesRow[] }) {
  const data = toPoints(series);

  return (
    <div>
      <ChartLegend
        items={[
          { label: "Vendas", color: "var(--accent)" },
          { label: "Locações", color: "var(--info)" },
        ]}
      />
      <ResponsiveContainer width="100%" height={224}>
        <BarChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: 0 }} barGap={2}>
          <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
          <XAxis {...xAxisProps} />
          <YAxis {...yAxisProps} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--surface-muted)" }} />
          <Bar dataKey="salesGross" name="Vendas" fill="var(--accent)" radius={[3, 3, 0, 0]} maxBarSize={18} />
          <Bar dataKey="rentalGross" name="Locações" fill="var(--info)" radius={[3, 3, 0, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function NetRevenueChart({ series }: { series: MonthlySeriesRow[] }) {
  const data = toPoints(series);

  return (
    <div>
      <ChartLegend items={[{ label: "Receita líquida da imobiliária", color: "var(--accent)" }]} />
      <ResponsiveContainer width="100%" height={224}>
        <BarChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
          <XAxis {...xAxisProps} />
          <YAxis {...yAxisProps} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--surface-muted)" }} />
          <Bar dataKey="net" name="Receita líquida" radius={[3, 3, 0, 0]} maxBarSize={22}>
            {data.map((point, index) => (
              <Cell key={index} fill={point.net < 0 ? "var(--danger)" : "var(--accent)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CompositionChart({
  netRevenue,
  brokerPayout,
}: {
  netRevenue: number;
  brokerPayout: number;
}) {
  const total = netRevenue + brokerPayout;

  if (total <= 0) {
    return (
      <p className="py-14 text-center text-[12.5px] text-muted">
        Sem comissões no período para compor o gráfico.
      </p>
    );
  }

  const data = [
    { name: "Receita líquida da imobiliária", value: netRevenue, color: "var(--accent)" },
    { name: "Repasse aos corretores", value: brokerPayout, color: "var(--warning)" },
  ];

  return (
    <div>
      <div className="relative">
        <ResponsiveContainer width="100%" height={172}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              innerRadius={54}
              outerRadius={76}
              paddingAngle={1.5}
              startAngle={90}
              endAngle={-270}
              stroke="var(--surface)"
              strokeWidth={2}
            >
              {data.map((slice) => (
                <Cell key={slice.name} fill={slice.color} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-subtle">
            Margem
          </span>
          <span className="metric-value-sm">
            {formatPercent((netRevenue / total) * 100, { maximumFractionDigits: 1 })}
          </span>
        </div>
      </div>

      <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
        {data.map((slice) => (
          <li key={slice.name} className="flex items-center justify-between gap-3 text-[12.5px]">
            <span className="flex items-center gap-1.5 text-muted">
              <span
                className="inline-block size-1.5 rounded-full"
                style={{ backgroundColor: slice.color }}
              />
              {slice.name}
            </span>
            <span className="shrink-0 font-semibold tabular">
              {formatCurrency(slice.value)}
              <span className="ml-1 font-normal text-subtle">
                {formatPercent((slice.value / total) * 100, { maximumFractionDigits: 0 })}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
