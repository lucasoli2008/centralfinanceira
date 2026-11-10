"use client";

import * as React from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCompactCurrency, formatCurrency, formatPercent } from "@/lib/formatting/number";
import { monthShortName } from "@/lib/formatting/date";
import type { FinCategoryTotalRow, FinMonthlyRow } from "@/types/database";

/*
 * Cores semânticas do financeiro (não usam o vermelho da marca, que aqui
 * seria lido como "problema"):
 *   entradas/receitas → info (azul)   saídas/despesas → cinza neutro
 *   resultado         → verde se ≥ 0, vermelho se < 0
 *   saldo             → tinta principal
 */
const IN_COLOR = "var(--info)";
const OUT_COLOR = "var(--foreground-subtle)";
const POSITIVE = "var(--positive)";
const NEGATIVE = "var(--danger)";
const INK = "var(--foreground)";
const PLANNED = "var(--border-strong)";
const AXIS_TICK = { fontSize: 10.5, fill: "var(--foreground-subtle)" } as const;
const GRID = "var(--border)";
const ANIMATION = { animationDuration: 620, animationEasing: "ease-out" } as const;

const CATEGORY_PALETTE = [
  "var(--info)",
  "color-mix(in srgb, var(--info) 70%, white)",
  "color-mix(in srgb, var(--info) 45%, white)",
  "var(--foreground-muted)",
  "var(--foreground-subtle)",
  "var(--border-strong)",
  "color-mix(in srgb, var(--warning) 70%, white)",
  "color-mix(in srgb, var(--positive) 60%, white)",
];

function monthLabel(row: FinMonthlyRow) {
  return `${monthShortName(row.month)} ${String(row.year).slice(2)}`;
}

function Legend({ items }: { items: { label: string; color: string; value?: string; dashed?: boolean }[] }) {
  return (
    <ul className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-baseline gap-1.5 text-[11.5px]">
          <span
            aria-hidden="true"
            className="inline-block h-[3px] w-3.5 shrink-0 self-center rounded-full"
            style={
              item.dashed
                ? { backgroundImage: `repeating-linear-gradient(to right, ${item.color} 0 4px, transparent 4px 6px)` }
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

function MoneyTooltip({
  active,
  payload,
  label,
  formatter = formatCurrency,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string }[];
  label?: string;
  formatter?: (value: number) => string;
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
              <span className="inline-block size-1.5 rounded-full" style={{ backgroundColor: item.color }} />
              {item.name}
            </span>
            <span className="font-semibold tabular">{formatter(item.value ?? 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const yAxis = {
  tick: AXIS_TICK,
  tickLine: false,
  axisLine: false,
  width: 62,
  tickCount: 5,
  tickFormatter: (value: number) => formatCompactCurrency(value),
} as const;

const xAxis = {
  dataKey: "label",
  tick: AXIS_TICK,
  tickLine: false,
  axisLine: false,
  interval: "preserveStartEnd",
  minTickGap: 14,
  dy: 4,
} as const;

/** Receitas, despesas e resultado dos últimos 12 meses (regime escolhido). */
export function ResultEvolutionChart({ series }: { series: FinMonthlyRow[] }) {
  const data = series.map((row) => ({
    label: monthLabel(row),
    revenue: row.revenue,
    expenses: row.expenses,
    result: row.result,
  }));
  const total = series.reduce((sum, row) => sum + row.result, 0);

  return (
    <div>
      <Legend
        items={[
          { label: "Receitas", color: IN_COLOR },
          { label: "Despesas", color: OUT_COLOR },
          { label: "Resultado acumulado", color: total >= 0 ? POSITIVE : NEGATIVE, value: formatCurrency(total) },
        ]}
      />
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }} barGap={3}>
          <CartesianGrid stroke={GRID} strokeDasharray="2 5" vertical={false} />
          <XAxis {...xAxis} />
          <YAxis {...yAxis} />
          <ReferenceLine y={0} stroke="var(--border-strong)" />
          <Tooltip content={<MoneyTooltip />} cursor={{ fill: "var(--surface-muted)", radius: 4 }} />
          <Bar dataKey="revenue" name="Receitas" fill={IN_COLOR} radius={[4, 4, 2, 2]} maxBarSize={14} {...ANIMATION} />
          <Bar dataKey="expenses" name="Despesas" fill={OUT_COLOR} radius={[4, 4, 2, 2]} maxBarSize={14} {...ANIMATION} />
          <Line
            type="monotone"
            dataKey="result"
            name="Resultado"
            stroke={INK}
            strokeWidth={2}
            dot={{ r: 2.5, strokeWidth: 0, fill: INK }}
            activeDot={{ r: 4 }}
            {...ANIMATION}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Entradas x saídas efetivas (baixas) por mês. */
export function CashInOutChart({ series }: { series: FinMonthlyRow[] }) {
  const data = series.map((row) => ({ label: monthLabel(row), cashIn: row.cash_in, cashOut: row.cash_out }));
  return (
    <div>
      <Legend
        items={[
          { label: "Entradas", color: IN_COLOR, value: formatCurrency(series.reduce((s, r) => s + r.cash_in, 0)) },
          { label: "Saídas", color: OUT_COLOR, value: formatCurrency(series.reduce((s, r) => s + r.cash_out, 0)) },
        ]}
      />
      <ResponsiveContainer width="100%" height={230}>
        <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }} barGap={3}>
          <CartesianGrid stroke={GRID} strokeDasharray="2 5" vertical={false} />
          <XAxis {...xAxis} />
          <YAxis {...yAxis} />
          <Tooltip content={<MoneyTooltip />} cursor={{ fill: "var(--surface-muted)", radius: 4 }} />
          <Bar dataKey="cashIn" name="Entradas" fill={IN_COLOR} radius={[4, 4, 2, 2]} maxBarSize={16} {...ANIMATION} />
          <Bar dataKey="cashOut" name="Saídas" fill={OUT_COLOR} radius={[4, 4, 2, 2]} maxBarSize={16} {...ANIMATION} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Saldo consolidado no fim de cada mês. */
export function CashBalanceChart({ series }: { series: FinMonthlyRow[] }) {
  const data = series.map((row) => ({ label: monthLabel(row), balance: row.closing_balance }));
  const last = series[series.length - 1];
  return (
    <div>
      <Legend items={[{ label: "Saldo no fim do mês", color: INK, value: last ? formatCurrency(last.closing_balance) : undefined }]} />
      <ResponsiveContainer width="100%" height={230}>
        <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="finBalanceArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={INK} stopOpacity={0.12} />
              <stop offset="100%" stopColor={INK} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="2 5" vertical={false} />
          <XAxis {...xAxis} />
          <YAxis {...yAxis} />
          <ReferenceLine y={0} stroke="var(--danger)" strokeDasharray="3 3" />
          <Tooltip content={<MoneyTooltip />} cursor={{ stroke: "var(--border-strong)", strokeDasharray: "3 3" }} />
          <Area
            type="monotone"
            dataKey="balance"
            name="Saldo"
            stroke={INK}
            fill="url(#finBalanceArea)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3.5, strokeWidth: 2, stroke: "var(--surface)" }}
            {...ANIMATION}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Margem líquida mês a mês (resultado ÷ receitas). */
export function MarginTrendChart({ series }: { series: FinMonthlyRow[] }) {
  const data = series.map((row) => ({
    label: monthLabel(row),
    margin: row.revenue > 0 ? Math.round((row.result / row.revenue) * 1000) / 10 : null,
  }));
  return (
    <div>
      <Legend items={[{ label: "Margem líquida", color: INK }]} />
      <ResponsiveContainer width="100%" height={230}>
        <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="2 5" vertical={false} />
          <XAxis {...xAxis} />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(value: number) => `${value}%`}
          />
          <ReferenceLine y={0} stroke="var(--border-strong)" />
          <Tooltip
            content={<MoneyTooltip formatter={(value) => formatPercent(value, { maximumFractionDigits: 1 })} />}
            cursor={{ stroke: "var(--border-strong)", strokeDasharray: "3 3" }}
          />
          <Line
            type="monotone"
            dataKey="margin"
            name="Margem"
            stroke={INK}
            strokeWidth={2}
            connectNulls
            dot={{ r: 2.5, strokeWidth: 0, fill: INK }}
            {...ANIMATION}
          />
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-2 text-[11.5px] text-subtle">Meses sem receita ficam sem ponto (sem base para cálculo).</p>
    </div>
  );
}

/** Previsto (títulos com vencimento no mês) x realizado (baixas do mês). */
export function PlannedVsActualChart({ series }: { series: FinMonthlyRow[] }) {
  const data = series.map((row) => ({
    label: monthLabel(row),
    plannedIn: row.planned_in,
    cashIn: row.cash_in,
    plannedOut: row.planned_out,
    cashOut: row.cash_out,
  }));
  return (
    <div>
      <Legend
        items={[
          { label: "Previsto a receber", color: PLANNED },
          { label: "Recebido", color: IN_COLOR },
          { label: "Previsto a pagar", color: "color-mix(in srgb, var(--foreground-subtle) 40%, white)" },
          { label: "Pago", color: OUT_COLOR },
        ]}
      />
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }} barGap={2}>
          <CartesianGrid stroke={GRID} strokeDasharray="2 5" vertical={false} />
          <XAxis {...xAxis} />
          <YAxis {...yAxis} />
          <Tooltip content={<MoneyTooltip />} cursor={{ fill: "var(--surface-muted)", radius: 4 }} />
          <Bar dataKey="plannedIn" name="Previsto a receber" fill={PLANNED} radius={[3, 3, 1, 1]} maxBarSize={9} {...ANIMATION} />
          <Bar dataKey="cashIn" name="Recebido" fill={IN_COLOR} radius={[3, 3, 1, 1]} maxBarSize={9} {...ANIMATION} />
          <Bar
            dataKey="plannedOut"
            name="Previsto a pagar"
            fill="color-mix(in srgb, var(--foreground-subtle) 40%, white)"
            radius={[3, 3, 1, 1]}
            maxBarSize={9}
            {...ANIMATION}
          />
          <Bar dataKey="cashOut" name="Pago" fill={OUT_COLOR} radius={[3, 3, 1, 1]} maxBarSize={9} {...ANIMATION} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Ranking de categorias (barras horizontais com participação). */
export function CategoryBreakdown({
  rows,
  emptyMessage,
  limit = 8,
}: {
  rows: FinCategoryTotalRow[];
  emptyMessage: string;
  limit?: number;
}) {
  if (rows.length === 0) {
    return <p className="py-12 text-center text-[12.5px] text-muted">{emptyMessage}</p>;
  }
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const top = rows.slice(0, limit);
  const rest = rows.slice(limit).reduce((sum, row) => sum + row.total, 0);
  const max = Math.max(...top.map((row) => row.total), 1);

  return (
    <ul className="space-y-2.5">
      {top.map((row) => (
        <li key={row.category_id}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="min-w-0 truncate">
              <span className="font-medium">{row.category_name}</span>
              <span className="ml-1.5 text-subtle">{row.group_name !== row.category_name ? row.group_name : ""}</span>
            </span>
            <span className="shrink-0 tabular">
              <span className="font-semibold">{formatCurrency(row.total)}</span>
              <span className="ml-1.5 text-subtle">{formatPercent((row.total / total) * 100, { maximumFractionDigits: 0 })}</span>
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
            <div className="h-full rounded-full bg-foreground/70" style={{ width: `${(row.total / max) * 100}%` }} />
          </div>
        </li>
      ))}
      {rest > 0 ? (
        <li className="flex justify-between border-t border-border pt-2 text-[12px] text-muted">
          <span>Outras {rows.length - limit} categorias</span>
          <span className="tabular">{formatCurrency(rest)}</span>
        </li>
      ) : null}
    </ul>
  );
}

/** Composição da receita própria por categoria (rosca). */
export function RevenueCompositionChart({ rows }: { rows: FinCategoryTotalRow[] }) {
  const own = rows.filter((row) => row.nature === "own_revenue" || row.nature === "other_revenue");
  const total = own.reduce((sum, row) => sum + row.total, 0);

  if (total <= 0) {
    return <p className="py-14 text-center text-[12.5px] text-muted">Sem receita própria no período.</p>;
  }

  const data = own.slice(0, 7).map((row, index) => ({
    name: row.category_name,
    value: row.total,
    color: CATEGORY_PALETTE[index % CATEGORY_PALETTE.length],
  }));

  return (
    <div>
      <div className="relative">
        <ResponsiveContainer width="100%" height={180}>
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
            <Tooltip content={<MoneyTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-subtle">Receita própria</span>
          <span className="metric-value-sm">{formatCompactCurrency(total)}</span>
        </div>
      </div>
      <ul className="mt-3 divide-y divide-border border-t border-border">
        {data.map((slice) => (
          <li key={slice.name} className="flex items-center justify-between gap-3 py-1.5 text-[12.5px]">
            <span className="flex min-w-0 items-center gap-1.5 text-muted">
              <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} />
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

export interface ProjectionPoint {
  label: string;
  inflow: number;
  outflow: number;
  balance: number;
}

/** Fluxo projetado: entradas e saídas previstas por período e o saldo acumulado. */
export function CashProjectionChart({ points }: { points: ProjectionPoint[] }) {
  const lowest = points.reduce<ProjectionPoint | null>((min, point) => (min === null || point.balance < min.balance ? point : min), null);
  return (
    <div>
      <Legend
        items={[
          { label: "Entradas previstas", color: IN_COLOR },
          { label: "Saídas previstas", color: OUT_COLOR },
          { label: "Saldo projetado", color: INK, value: lowest ? `mínimo ${formatCurrency(lowest.balance)}` : undefined },
        ]}
      />
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart
          data={points.map((point) => ({ ...point, outflowNegative: -point.outflow }))}
          margin={{ top: 6, right: 8, bottom: 0, left: 0 }}
          barGap={2}
        >
          <CartesianGrid stroke={GRID} strokeDasharray="2 5" vertical={false} />
          <XAxis {...xAxis} />
          <YAxis {...yAxis} />
          <ReferenceLine y={0} stroke="var(--danger)" strokeDasharray="3 3" />
          <Tooltip content={<MoneyTooltip />} cursor={{ fill: "var(--surface-muted)", radius: 4 }} />
          <Bar dataKey="inflow" name="Entradas" fill={IN_COLOR} radius={[4, 4, 2, 2]} maxBarSize={16} {...ANIMATION} />
          <Bar dataKey="outflowNegative" name="Saídas" fill={OUT_COLOR} radius={[2, 2, 4, 4]} maxBarSize={16} {...ANIMATION} />
          <Line
            type="monotone"
            dataKey="balance"
            name="Saldo"
            stroke={INK}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3.5, strokeWidth: 2, stroke: "var(--surface)" }}
            {...ANIMATION}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
