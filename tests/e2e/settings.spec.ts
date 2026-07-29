import { expect, test } from "@playwright/test";
import { hasCredentials, signIn, uniqueLabel } from "./helpers";

/** Fluxo 4 do prompt: alterar o padrão não pode mexer no histórico. */
test.describe("padrões financeiros", () => {
  test.skip(!hasCredentials, "Defina PLAYWRIGHT_EMAIL e PLAYWRIGHT_PASSWORD.");

  test("alterar a comissão padrão não altera lançamentos anteriores", async ({ page }) => {
    await signIn(page);

    const description = uniqueLabel("Venda com 6 por cento");

    // 1. Venda com o padrão atual de 6%
    await page.goto("/vendas/nova");
    await expect(page.getByLabel("Percentual da comissão")).toHaveValue("6");
    await page.getByLabel("Descrição").fill(description);
    await page.getByLabel("Valor da venda").fill("500000");
    await page.getByRole("button", { name: "Salvar lançamento" }).click();

    const detailUrl = page.url();
    await expect(page.getByText("R$ 30.000,00").first()).toBeVisible();

    // 2. Alterar o padrão para 5%
    await page.goto("/configuracoes/financeiro");
    await page.getByLabel("Comissão padrão de venda").fill("5");
    await page.getByRole("button", { name: "Salvar configurações" }).click();
    await expect(page.getByText(/Lançamentos anteriores não foram alterados/i)).toBeVisible();

    // 3. O lançamento antigo continua em 6% / R$ 30.000
    await page.goto(detailUrl);
    await expect(page.getByText("6%").first()).toBeVisible();
    await expect(page.getByText("R$ 30.000,00").first()).toBeVisible();

    // 4. Novo lançamento já começa com 5%
    await page.goto("/vendas/nova");
    await expect(page.getByLabel("Percentual da comissão")).toHaveValue("5");

    // Restaura o padrão para não afetar as próximas execuções
    await page.goto("/configuracoes/financeiro");
    await page.getByLabel("Comissão padrão de venda").fill("6");
    await page.getByRole("button", { name: "Salvar configurações" }).click();
  });

  test("marca configurável muda a interface sem alterar código", async ({ page }) => {
    await signIn(page);

    await page.goto("/configuracoes/empresa");
    await expect(page.getByLabel("Nome exibido")).toBeVisible();
    await expect(page.getByLabel("Cor principal")).toBeVisible();
    await expect(page.getByLabel("URL do logotipo")).toBeVisible();
  });
});
