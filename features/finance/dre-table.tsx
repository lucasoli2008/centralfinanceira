import { Fragment } from "react";
import { formatCurrency, formatPercent } from "@/lib/formatting/number";
import { monthShortName } from "@/lib/formatting/date";
import { cn } from "@/lib/utils";
import type { DreSection, DreStatement, DreValues } from "@/lib/finance/dre";

/** Até 12 meses mostramos colunas mensais; acima disso, só o total do período. */
export const DRE_MAX_MONTH_COLUMNS = 12;

function periodLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  return `${monthShortName(month)}/${String(year).slice(2)}`;
}

function Money({ value, strong = false }: { value: number; strong?: boolean }) {
  return (
    <span className={cn("tabular", value < 0 && "text-muted", strong && "font-semibold text-foreground", strong && value < 0 && "text-danger")}>
      {value === 0 ? "—" : formatCurrency(value)}
    </span>
  );
}

function ValueCells({ values, periods, strong = false }: { values: DreValues; periods: string[]; strong?: boolean }) {
  return (
    <>
      {periods.map((period) => (
        <td key={period} className="whitespace-nowrap px-3 py-1.5 text-right">
          <Money value={values.byPeriod[period] ?? 0} strong={strong} />
        </td>
      ))}
      <td className="whitespace-nowrap bg-surface-sunken px-3 py-1.5 text-right">
        <Money value={values.total} strong />
      </td>
    </>
  );
}

function SectionRows({ section, periods }: { section: DreSection; periods: string[] }) {
  return (
    <>
      <tr className="border-t border-border bg-surface-muted/60">
        <th scope="row" className="px-3 py-2 text-left text-[13px] font-semibold">
          {section.label}
        </th>
        <ValueCells values={section} periods={periods} strong />
      </tr>
      {section.groups.map((group) => (
        <Fragment key={group.id}>
          <tr>
            <th scope="row" className="px-3 py-1.5 pl-6 text-left text-[12.5px] font-medium text-muted">
              {group.name}
            </th>
            <ValueCells values={group} periods={periods} />
          </tr>
          {group.categories.length > 1 || group.categories[0]?.name !== group.name
            ? group.categories.map((category) => (
                <tr key={category.id} className="text-[12px]">
                  <th scope="row" className="px-3 py-1 pl-10 text-left font-normal text-subtle">
                    {category.name}
                  </th>
                  <ValueCells values={category} periods={periods} />
                </tr>
              ))
            : null}
        </Fragment>
      ))}
    </>
  );
}

export function DreTable({ dre }: { dre: DreStatement }) {
  const periods = dre.periods.length > 1 && dre.periods.length <= DRE_MAX_MONTH_COLUMNS ? dre.periods : [];

  return (
    <div className="surface-card overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
        <caption className="sr-only">Demonstração do resultado gerencial</caption>
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wide text-subtle">
            <th scope="col" className="px-3 py-2 text-left font-semibold">
              Linha
            </th>
            {periods.map((period) => (
              <th key={period} scope="col" className="px-3 py-2 text-right font-semibold">
                {periodLabel(period)}
              </th>
            ))}
            <th scope="col" className="bg-surface-sunken px-3 py-2 text-right font-semibold">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {dre.rows.map((row) =>
            row.type === "section" ? (
              row.section.groups.length || ["gross_revenue", "operating_expenses"].includes(row.section.key) ? (
                <SectionRows key={row.section.key} section={row.section} periods={periods} />
              ) : null
            ) : (
              <tr
                key={row.subtotal.key}
                className={cn("border-t border-border-strong", row.subtotal.emphasis ? "bg-accent-soft" : "bg-surface")}
              >
                <th scope="row" className={cn("px-3 py-2 text-left text-[13px] font-semibold", row.subtotal.emphasis && "text-accent")}>
                  {row.subtotal.label}
                </th>
                <ValueCells values={row.subtotal} periods={periods} strong />
              </tr>
            ),
          )}
          <tr className="border-t border-border text-[12px] text-muted">
            <th scope="row" className="px-3 py-1.5 text-left font-normal">
              Margem líquida (resultado ÷ receita bruta)
            </th>
            {periods.map((period) => (
              <td key={period} className="px-3 py-1.5 text-right tabular">
                {dre.netMargin[period] === null || dre.netMargin[period] === undefined ? "—" : formatPercent(dre.netMargin[period] as number)}
              </td>
            ))}
            <td className="bg-surface-sunken px-3 py-1.5 text-right font-medium tabular">
              {dre.netMargin.total === null ? "—" : formatPercent(dre.netMargin.total)}
            </td>
          </tr>
        </tbody>
      </table>

      {dre.memo.length ? (
        <div className="border-t-4 border-double border-border">
          <p className="px-3 pt-3 text-[12px] font-semibold uppercase tracking-wide text-subtle">Fora do resultado (memória)</p>
          <p className="px-3 pb-2 text-[12px] text-muted">
            Dinheiro que passou pelo caixa mas não é receita nem despesa da imobiliária. Valores com sinal de entrada (+) e
            saída (−).
          </p>
          <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
            <tbody>
              {dre.memo.map((section) => (
                <SectionRows key={section.key} section={section} periods={periods} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
