import * as React from "react";
import { cn } from "@/lib/utils";

interface SparklineProps {
  values: number[];
  className?: string;
  /** Cor da linha; herda a cor do texto por padrão. */
  stroke?: string;
  /** Preenchimento suave abaixo da linha. */
  fill?: boolean;
  height?: number;
  strokeWidth?: number;
  /** Destaca o último ponto com um círculo. */
  markLast?: boolean;
}

/**
 * Sparkline em SVG puro: sem biblioteca, sem JavaScript no cliente.
 * Usada nos indicadores para dar contexto de tendência sem ocupar espaço.
 */
export function Sparkline({
  values,
  className,
  stroke = "currentColor",
  fill = true,
  height = 40,
  strokeWidth = 1.75,
  markLast = true,
}: SparklineProps) {
  // Hook antes de qualquer retorno antecipado.
  const gradientId = React.useId();

  if (values.length < 2) {
    return <div className={cn("h-10", className)} style={{ height }} aria-hidden="true" />;
  }

  const width = 100;
  const min = Math.min(...values, 0);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    // 4% de respiro no topo e na base para a linha não encostar na borda
    const y = height - 2 - ((value - min) / range) * (height - 4);
    return { x, y };
  });

  const line = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(" ");

  const area = `${line} L${width},${height} L0,${height} Z`;
  const last = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("w-full", className)}
      style={{ height }}
      aria-hidden="true"
      focusable="false"
    >
      {fill ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradientId})`} />
        </>
      ) : null}

      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />

      {markLast ? (
        <circle cx={last.x} cy={last.y} r={2.25} fill={stroke} vectorEffect="non-scaling-stroke" />
      ) : null}
    </svg>
  );
}

/**
 * Barra de proporção usada em tabelas (ranking de corretores, participação de
 * cada mês). Comunica "quanto deste total" sem precisar de um gráfico.
 */
export function ShareBar({
  value,
  total,
  className,
  tone = "accent",
}: {
  value: number;
  total: number;
  className?: string;
  tone?: "accent" | "warning" | "info";
}) {
  const share = total > 0 ? Math.min(Math.max(value / total, 0), 1) : 0;

  const tones = {
    accent: "bg-accent",
    warning: "bg-warning",
    info: "bg-info",
  } as const;

  return (
    <div
      className={cn("h-1 w-full overflow-hidden rounded-full bg-surface-muted", className)}
      aria-hidden="true"
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500", tones[tone])}
        style={{ width: `${(share * 100).toFixed(2)}%` }}
      />
    </div>
  );
}
