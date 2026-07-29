import { expect, type Page } from "@playwright/test";

export const CREDENTIALS = {
  email: process.env.PLAYWRIGHT_EMAIL ?? "",
  password: process.env.PLAYWRIGHT_PASSWORD ?? "",
};

export const hasCredentials = Boolean(CREDENTIALS.email && CREDENTIALS.password);

/** Faz login e aguarda o dashboard. */
export async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(CREDENTIALS.email);
  await page.getByLabel("Senha").fill(CREDENTIALS.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

/** Converte "R$ 12.345,67" em 12345.67 para comparações numéricas. */
export function parseCurrency(text: string): number {
  const normalized = text
    .replace(/\s| /g, "")
    .replace("R$", "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace("−", "-");
  return Number(normalized);
}

/** Descrição única, para não colidir entre execuções. */
export function uniqueLabel(prefix: string): string {
  return `${prefix} ${Date.now().toString().slice(-6)}`;
}
