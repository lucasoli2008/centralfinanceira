import { expect, test } from "@playwright/test";
import { hasCredentials, parseCurrency, signIn, uniqueLabel } from "./helpers";

test.describe("fluxos de lançamento", () => {
  test.skip(!hasCredentials, "Defina PLAYWRIGHT_EMAIL e PLAYWRIGHT_PASSWORD.");

  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  /** Fluxo 1 do prompt: corretor → venda com dois corretores → dashboard → mês → PDF. */
  test("cadastra corretor, registra venda com dois corretores e gera PDF do mês", async ({
    page,
  }) => {
    const brokerName = uniqueLabel("Corretor Teste");
    const description = uniqueLabel("Venda Apartamento Centro");

    // Corretor
    await page.goto("/corretores");
    await page.getByRole("button", { name: "Novo corretor" }).click();
    await page.getByLabel("Nome completo").fill(brokerName);
    await page.getByRole("button", { name: "Cadastrar corretor" }).click();
    await expect(page.getByRole("cell", { name: brokerName })).toBeVisible();

    // Venda R$ 500.000 · 6% · dois corretores (40% e 15%)
    await page.goto("/vendas/nova");
    await page.getByLabel("Descrição").fill(description);
    await page.getByLabel("Valor da venda").fill("500000");
    await page.getByLabel("Percentual da comissão").fill("6");

    await page.getByRole("button", { name: "Adicionar corretor" }).click();
    await page.getByLabel("Corretor").first().selectOption({ label: brokerName });
    await page.getByLabel("Percentual do repasse").first().fill("40");

    await page.getByRole("button", { name: "Adicionar corretor" }).click();
    await page.getByLabel("Percentual do repasse").nth(1).fill("15");

    // Resumo em tempo real: 30.000 − 16.500 = 13.500
    const summary = page.getByRole("region").filter({ hasText: "Resumo financeiro" });
    await expect(summary).toContainText("R$ 30.000,00");
    await expect(summary).toContainText("R$ 16.500,00");
    await expect(summary).toContainText("R$ 13.500,00");

    await page.getByRole("button", { name: "Salvar lançamento" }).click();

    // Detalhe do lançamento com os mesmos valores
    await expect(page.getByRole("heading", { name: description })).toBeVisible();
    await expect(page.getByText("R$ 13.500,00")).toBeVisible();

    // Dashboard consolidado
    await page.goto("/dashboard?periodo=ano-atual");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // Visão mensal e PDF
    const today = new Date();
    await page.goto(`/meses/${today.getFullYear()}/${today.getMonth() + 1}`);
    await expect(page.getByRole("cell", { name: description })).toBeVisible();

    const pdf = page.waitForEvent("popup");
    await page.getByRole("link", { name: "PDF do mês" }).click();
    const pdfPage = await pdf;
    expect(pdfPage.url()).toContain("/api/relatorios/mensal");
  });

  /** Fluxo 2 do prompt: locação 100% com repasse de 50%. */
  test("registra locação com comissão de 100% e repasse de 50%", async ({ page }) => {
    const description = uniqueLabel("Locação Residencial Vila Nova");

    await page.goto("/locacoes/nova");

    // O rótulo do valor-base muda em relação à venda.
    await expect(page.getByLabel("Valor do primeiro aluguel")).toBeVisible();

    await page.getByLabel("Descrição").fill(description);
    await page.getByLabel("Valor do primeiro aluguel").fill("3000");

    // Padrão de locação é 100%.
    await expect(page.getByLabel("Percentual da comissão")).toHaveValue("100");

    await page.getByRole("button", { name: "Adicionar corretor" }).click();
    await page.getByLabel("Percentual do repasse").first().fill("50");

    const summary = page.getByRole("region").filter({ hasText: "Resumo financeiro" });
    await expect(summary).toContainText("R$ 3.000,00");
    await expect(summary).toContainText("R$ 1.500,00");

    await page.getByRole("button", { name: "Salvar lançamento" }).click();
    await expect(page.getByRole("heading", { name: description })).toBeVisible();

    const net = await page.getByText(/R\$ 1\.500,00/).first().textContent();
    expect(parseCurrency(net ?? "")).toBe(1500);
  });

  test("bloqueia repasse maior que a comissão bruta sem exceção confirmada", async ({ page }) => {
    await page.goto("/vendas/nova");
    await page.getByLabel("Descrição").fill(uniqueLabel("Venda com exceção"));
    await page.getByLabel("Valor da venda").fill("100000");
    await page.getByLabel("Percentual da comissão").fill("5");

    await page.getByRole("button", { name: "Adicionar corretor" }).click();
    await page.getByLabel("Forma do repasse").first().selectOption("fixed");
    await page.getByLabel("Valor do repasse").first().fill("6000");

    await page.getByRole("button", { name: "Salvar lançamento" }).click();

    // Diálogo de exceção financeira exige justificativa.
    await expect(page.getByRole("dialog")).toContainText("Confirmar exceção financeira");
    await page.getByRole("button", { name: "Confirmar e salvar" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("impede o mesmo corretor duas vezes no lançamento", async ({ page }) => {
    await page.goto("/vendas/nova");
    await page.getByLabel("Descrição").fill(uniqueLabel("Venda duplicada"));
    await page.getByLabel("Valor da venda").fill("300000");

    await page.getByRole("button", { name: "Adicionar corretor" }).click();
    await page.getByRole("button", { name: "Adicionar corretor" }).click();

    const brokerSelects = page.getByLabel("Corretor");
    const firstValue = await brokerSelects.first().inputValue();
    await brokerSelects.nth(1).selectOption(firstValue);

    await page.getByRole("button", { name: "Salvar lançamento" }).click();
    await expect(page.getByText("Este corretor já foi adicionado ao lançamento.")).toBeVisible();
  });
});
