"use client";

import * as React from "react";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField, Input, NativeSelect } from "@/components/ui/field";
import { MONTH_NAMES, firstDayOfMonth, lastDayOfMonth } from "@/lib/formatting/date";
import { buildSearchParams } from "@/lib/utils";
import type { BrokerRow } from "@/types/database";

type ReportType = "mensal" | "anual" | "corretor" | "filtrado";

interface ReportLauncherProps {
  type: ReportType;
  years: number[];
  brokers: BrokerRow[];
}

export function ReportLauncher({ type, years, brokers }: ReportLauncherProps) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const availableYears = years.length ? years : [currentYear];

  const [year, setYear] = React.useState(String(availableYears[0] ?? currentYear));
  const [month, setMonth] = React.useState(String(now.getMonth() + 1));
  const [brokerId, setBrokerId] = React.useState(brokers[0]?.id ?? "");
  const [entryType, setEntryType] = React.useState("");
  const [propertyType, setPropertyType] = React.useState("");
  const [from, setFrom] = React.useState(firstDayOfMonth(currentYear, now.getMonth() + 1));
  const [to, setTo] = React.useState(lastDayOfMonth(currentYear, now.getMonth() + 1));

  const href = React.useMemo(() => {
    if (type === "mensal") return `/api/relatorios/mensal?ano=${year}&mes=${month}`;
    if (type === "anual") return `/api/relatorios/anual?ano=${year}`;
    if (type === "corretor") {
      return `/api/relatorios/corretor${buildSearchParams({ corretor: brokerId, de: from, ate: to })}`;
    }
    return `/api/relatorios/filtrado${buildSearchParams({
      de: from,
      ate: to,
      tipo: entryType,
      corretor: brokerId && entryType !== "" ? brokerId : null,
      imovel: propertyType,
    })}`;
  }, [type, year, month, brokerId, entryType, propertyType, from, to]);

  return (
    <div className="space-y-3">
      {type === "mensal" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Mês" htmlFor={`${type}-mes`}>
            <NativeSelect
              id={`${type}-mes`}
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            >
              {MONTH_NAMES.map((name, index) => (
                <option key={name} value={index + 1}>
                  {name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Ano" htmlFor={`${type}-ano`}>
            <NativeSelect
              id={`${type}-ano`}
              value={year}
              onChange={(event) => setYear(event.target.value)}
            >
              {availableYears.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        </div>
      ) : null}

      {type === "anual" ? (
        <FormField label="Ano" htmlFor={`${type}-ano`}>
          <NativeSelect
            id={`${type}-ano`}
            value={year}
            onChange={(event) => setYear(event.target.value)}
          >
            {availableYears.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      ) : null}

      {type === "corretor" ? (
        <div className="grid gap-3">
          <FormField label="Corretor" htmlFor={`${type}-corretor`}>
            <NativeSelect
              id={`${type}-corretor`}
              value={brokerId}
              onChange={(event) => setBrokerId(event.target.value)}
            >
              {brokers.map((broker) => (
                <option key={broker.id} value={broker.id}>
                  {broker.full_name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <PeriodInputs from={from} to={to} onFrom={setFrom} onTo={setTo} prefix={type} />
        </div>
      ) : null}

      {type === "filtrado" ? (
        <div className="grid gap-3">
          <PeriodInputs from={from} to={to} onFrom={setFrom} onTo={setTo} prefix={type} />
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Tipo de entrada" htmlFor={`${type}-tipo`}>
              <NativeSelect
                id={`${type}-tipo`}
                value={entryType}
                onChange={(event) => setEntryType(event.target.value)}
              >
                <option value="">Vendas e locações</option>
                <option value="sale">Somente vendas</option>
                <option value="rental">Somente locações</option>
              </NativeSelect>
            </FormField>
            <FormField label="Tipo do imóvel" htmlFor={`${type}-imovel`}>
              <NativeSelect
                id={`${type}-imovel`}
                value={propertyType}
                onChange={(event) => setPropertyType(event.target.value)}
              >
                <option value="">Residencial e comercial</option>
                <option value="residential">Residencial</option>
                <option value="commercial">Comercial</option>
              </NativeSelect>
            </FormField>
          </div>
          <FormField label="Corretor" htmlFor={`${type}-corretor`}>
            <NativeSelect
              id={`${type}-corretor`}
              value={brokerId}
              onChange={(event) => setBrokerId(event.target.value)}
            >
              <option value="">Todos os corretores</option>
              {brokers.map((broker) => (
                <option key={broker.id} value={broker.id}>
                  {broker.full_name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        </div>
      ) : null}

      <Button asChild className="w-full sm:w-auto">
        <a href={href} target="_blank" rel="noopener noreferrer">
          <FileDown />
          Gerar PDF
        </a>
      </Button>
    </div>
  );
}

function PeriodInputs({
  from,
  to,
  onFrom,
  onTo,
  prefix,
}: {
  from: string;
  to: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  prefix: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField label="De" htmlFor={`${prefix}-de`}>
        <Input
          id={`${prefix}-de`}
          type="date"
          value={from}
          onChange={(event) => onFrom(event.target.value)}
        />
      </FormField>
      <FormField label="Até" htmlFor={`${prefix}-ate`}>
        <Input
          id={`${prefix}-ate`}
          type="date"
          value={to}
          onChange={(event) => onTo(event.target.value)}
        />
      </FormField>
    </div>
  );
}
