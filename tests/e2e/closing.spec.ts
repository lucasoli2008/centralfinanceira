import { expect, test } from "@playwright/test";
import { hasCredentials, signIn, uniqueLabel } from "./helpers";

/** Fluxo 3 do prompt: fechar mês → bloquear edição → reabrir com justificativa → auditar. */
test.describe("fechamento mensal", () => {
  test.skip(!hasCredentials, "Defina PLAYWRIGHT_EMAIL e PLAYWRIGHT_PASSWORD.");

  test("fecha o mês, bloqueia alterações, reabre com justificativa e registra na auditoria", async ({
    page,
  }) => {
    await signIn(page);

    const description = uniqueLabel("Venda para fechamento");
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;

    // Lançamento no mês atual
    await page.goto("/vendas/nova");
    await page.getByLabel("Descrição").fill(description);
    await page.getByLabel("Valor da venda").fill("250000");
    await page.getByRole("button", { name: "Salvar lançamento" }).click();
    await expect(page.getByRole("heading", { name: description })).toBeVisible();

    // Fechar o mês
    await page.goto(`/meses/${year}/${month}`);
    await page.getByRole("button", { name: "Fechar mês" }).click();
    await expect(page.getByText("Este mês financeiro está fechado")).toBeVisible();

    // Nova tentativa de lançamento no mês fechado é bloqueada
    await page.goto("/vendas/nova");
    await page.getByLabel("Descrição").fill(uniqueLabel("Venda bloqueada"));
    await page.getByLabel("Valor da venda").fill("100000");
    await page.getByRole("button", { name: "Salvar lançamento" }).click();
    await expect(page.getByText(/mês financeiro está fechado/i)).toBeVisible();

    // Reabrir exige justificativa de 10+ caracteres
    await page.goto(`/meses/${year}/${month}`);
    await page.getByRole("button", { name: "Reabrir mês" }).click();
    const reopenButton = page.getByRole("button", { name: "Reabrir mês" }).last();
    await page.getByLabel("Justificativa").fill("curta");
    await expect(reopenButton).toBeDisabled();

    await page.getByLabel("Justificativa").fill("Correção solicitada pela diretoria");
    await reopenButton.click();
    await expect(page.getByText("Mês aberto")).toBeVisible();

    // Auditoria registra fechamento e reabertura
    await page.goto("/auditoria");
    await expect(page.getByRole("cell", { name: "Fechamento mensal" }).first()).toBeVisible();
    await expect(page.getByText("Correção solicitada pela diretoria").first()).toBeVisible();
  });
});
