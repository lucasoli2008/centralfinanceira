// @vitest-environment jsdom

import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MoneyInput, PercentInput } from "@/components/finance/money-input";

function ControlledMoney({ onChange }: { onChange: (value: number | null) => void }) {
  const [value, setValue] = React.useState<number | null>(null);

  return (
    <MoneyInput
      id="valor"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe("MoneyInput", () => {
  it("aceita os formatos que uma pessoa realmente digita", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ControlledMoney onChange={onChange} />);
    const input = screen.getByRole("textbox");

    for (const [typed, expected] of [
      ["500000", 500000],
      ["500.000", 500000],
      ["500.000,00", 500000],
      ["R$ 500.000,00", 500000],
      ["1234,56", 1234.56],
    ] as const) {
      await user.clear(input);
      await user.type(input, typed);
      expect(onChange).toHaveBeenLastCalledWith(expected);
    }
  });

  it("formata no padrão brasileiro ao sair do campo", async () => {
    const user = userEvent.setup();

    render(<ControlledMoney onChange={() => {}} />);
    const input = screen.getByRole("textbox");

    await user.type(input, "500000");
    await user.tab();

    expect(input).toHaveValue("500.000,00");
  });

  it("mostra o prefixo R$ sem misturá-lo ao valor", () => {
    render(<ControlledMoney onChange={() => {}} />);
    expect(screen.getByText("R$")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("");
  });
});

function ControlledPercent({ onChange }: { onChange: (value: number | null) => void }) {
  const [value, setValue] = React.useState<number | null>(null);

  return (
    <PercentInput
      id="percentual"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe("PercentInput", () => {
  it("interpreta o valor em pontos percentuais, com vírgula decimal", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ControlledPercent onChange={onChange} />);
    const input = screen.getByRole("textbox");

    await user.type(input, "6");
    expect(onChange).toHaveBeenLastCalledWith(6);

    await user.clear(input);
    await user.type(input, "5,5");
    expect(onChange).toHaveBeenLastCalledWith(5.5);

    await user.clear(input);
    await user.type(input, "37,5%");
    expect(onChange).toHaveBeenLastCalledWith(37.5);
  });

  it("exibe o sufixo de percentual", () => {
    render(<ControlledPercent onChange={() => {}} />);
    expect(screen.getByText("%")).toBeInTheDocument();
  });
});
