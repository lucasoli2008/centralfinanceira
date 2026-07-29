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
const ANIMATION = { animationDuration: 620, animationEasing: "ease-out" } as const;

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
function ChartLegend({
  items,
}: {
  items: { label: string; color: string; dashed?: boolean; value?: string }[];
}) {
  return (
    <ul className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-baseline gap-1.5 text-[11.5px]">
          <span
            aria-hidden="true"
            className="inline-block h-[3px] w-3.5 shrink-0 self-center rounded-full"
            style={
              item.dashed
                ? {
                    backgroundImage: `repeating-linear-gradient(to right, ${item.color} 0 4px, transparent 4px 6px)`,
                  }
                : { backgroundColor: item.color }
            }
          />
          <span className="text-muted">{item.label}</span>
          {item.value ? <span className="font-semibold tabular">{item.value}</span> : null}
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
    <div className="min-w-44 overflow-hidden rounded-control border border-border bg-surface shadow-popover">
      <p className="border-b border-border bg-surface-sunken px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-subtle">
        {label}
      </p>
      <ul className="space-y-1 px-2.5 py-2">
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
  width: 60,
  tickCount: 5,
  tickFormatter: (value: number) => formatCompactCurrency(value),
} as const;

const xAxisProps = {
  dataKey: "label",
  tick: AXIS_TICK,
  tickLine: false,
  axisLine: false,
  interval: "preserveStartEnd",
  minTickGap: 14,
  dy: 4,
} as const;

export function MonthlyEvolutionChart({ series }: { series: MonthlySeriesRow[] }) {
  const data = toPoints(series);
  const latest = data[data.length - 1];

  return (
    <div>
      <ChartLegend
        items={[
          { label: "Comissão bruta", color: "var(--accent)", value: latest ? formatCurrency(latest.gross) : undefined },
          { label: "Receita líquida", color: "var(--info)", value: latest ? formatCurrency(latest.net) : undefined },
          { label: "Repasses", color: "var(--warning)", dashed: true },
        ]}
      />
      <ResponsiveContainer width="100%" height={252}>
        <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="grossArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.2} />
              <stop offset="70%" stopColor="var(--accent)" stopOpacity={0.02} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="netArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--info)" stopOpacity={0.1} />
              <stop offset="100%" stopColor="var(--info)" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke={GRID} strokeDasharray="2 5" vertical={false} />
          <XAxis {...xAxisProps} />
          <YAxis {...yAxisProps} />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ stroke: "var(--border-strong)", strokeWidth: 1, strokeDasharray: "3 3" }}
          />

          <Area
            type="monotone"
            dataKey="gross"
            name="Comissão bruta"
            stroke="var(--accent)"
            fill="url(#grossArea)"
            strokeWidth={2}
            strokeLinecap="round"
            dot={false}
            activeDot={{ r: 3.5, strokeWidth: 2, stroke: "var(--surface)" }}
            {...ANIMATION}
          />
          <Area
            type="monotone"
            dataKey="net"
            name="Receita líquida"
            stroke="var(--info)"
            fill="url(#netArea)"
            strokeWidth={2}
            strokeLinecap="round"
            dot={false}
            activeDot={{ r: 3.5, strokeWidth: 2, stroke: "var(--surface)" }}
            {...ANIMATION}
          />
          <Area
            type="monotone"
            dataKey="payout"
            name="Repasses"
            stroke="var(--warning)"
            fill="transparent"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
            activeDot={{ r: 3, strokeWidth: 2, stroke: "var(--surface)" }}
            {...ANIMATION}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SalesVsRentalsChart({ series }: { series: MonthlySeriesRow[] }) {
  const data = toPoints(series);
  const totalSales = data.reduce((sum, point) => sum + point.salesGross, 0);
  const totalRentals = data.reduce((sum, point) => sum + point.rentalGross, 0);

  return (
    <div>
      <ChartLegend
        items={[
          { label: "Vendas", color: "var(--accent)", value: formatCurrency(totalSales) },
          { label: "Locações", color: "var(--info)", value: formatCurrency(totalRentals) },
        ]}
      />
      <ResponsiveContainer width="100%" height={228}>
        <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }} barGap={3}>
          <CartesianGrid stroke={GRID} strokeDasharray="2 5" vertical={false} />
          <XAxis {...xAxisProps} />
          <YAxis {...yAxisProps} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--surface-muted)", radius: 4 }} />
          <Bar
            dataKey="salesGross"
            name="Vendas"
            fill="var(--accent)"
            radius={[4, 4, 2, 2]}
            maxBarSize={16}
            {...ANIMATION}
          />
          <Bar
            dataKey="rentalGross"
            name="Locações"
            fill="var(--info)"
            radius={[4, 4, 2, 2]}
            maxBarSize={16}
            {...ANIMATION}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function NetRevenueChart({ series }: { series: MonthlySeriesRow[] }) {
  const data = toPoints(series);
  const best = Math.max(...data.map((point) => point.net), 0);

  return (
    <div>
      <ChartLegend
        items={[{ label: "Melhor mês", color: "var(--accent)", value: formatCurrency(best) }]}
      />
      <ResponsiveContainer width="100%" height={228}>
        <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="2 5" vertical={false} />
          <XAxis {...xAxisProps} />
          <YAxis {...yAxisProps} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--surface-muted)", radius: 4 }} />
          <Bar dataKey="net" name="Receita líquida" radius={[4, 4, 2, 2]} maxBarSize={22} {...ANIMATION}>
            {data.map((point, index) => (
              <Cell
                key={index}
                fill={
                  point.net < 0
                    ? "var(--danger)"
                    : point.net === best && best > 0
                      ? "var(--accent)"
                      : "var(--accent-border)"
                }
              />
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
      <p className="py-16 text-center text-[12.5px] text-muted">
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
        <ResponsiveContainer width="100%" height={178}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              innerRadius={56}
              outerRadius={80}
              paddingAngle={2}
              cornerRadius={4}
              startAngle={90}
              endAngle={-270}
              stroke="var(--surface)"
              strokeWidth={2}
              {...ANIMATION}
            >
              {data.map((slice) => (
                <Cell key={slice.name} fill={slice.color} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-subtle">
            Margem
          </span>
          <span className="metric-value-sm">
            {formatPercent((netRevenue / total) * 100, { maximumFractionDigits: 1 })}
          </span>
        </div>
      </div>

      <ul className="mt-3 divide-y divide-border border-t border-border">
        {data.map((slice) => (
          <li key={slice.name} className="flex items-center justify-between gap-3 py-2 text-[12.5px]">
            <span className="flex min-w-0 items-center gap-1.5 text-muted">
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: slice.color }}
              />
              <span className="truncate">{slice.name}</span>
            </span>
            <span className="shrink-0 font-semibold tabular">
              {formatCurrency(slice.value)}
              <span className="ml-1.5 font-normal text-subtle">
                {formatPercent((slice.value / total) * 100, { maximumFractionDigits: 0 })}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
