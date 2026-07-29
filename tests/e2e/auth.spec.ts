import { expect, test } from "@playwright/test";
import { CREDENTIALS, hasCredentials, signIn } from "./helpers";

test.describe("autenticação e proteção de rotas", () => {
  test("rota interna sem sessão redireciona para o login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Entrar na conta" })).toBeVisible();
  });

  test("não existe cadastro público", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Não existe cadastro público")).toBeVisible();
    await expect(page.getByRole("link", { name: /criar conta|cadastrar/i })).toHaveCount(0);
  });

  test("credenciais inválidas mostram mensagem humana", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill("ninguem@exemplo.com");
    await page.getByLabel("Senha").fill("senha-errada");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("alert")).toContainText("E-mail ou senha incorretos");
  });

  test("recuperação de senha não revela se o e-mail existe", async ({ page }) => {
    await page.goto("/recuperar-senha");
    await page.getByLabel("E-mail").fill("ninguem@exemplo.com");
    await page.getByRole("button", { name: /enviar link/i }).click();
    await expect(page.getByRole("status")).toContainText("Se este e-mail estiver cadastrado");
  });

  test("login e logout", async ({ page }) => {
    test.skip(!hasCredentials, "Defina PLAYWRIGHT_EMAIL e PLAYWRIGHT_PASSWORD.");

    await signIn(page);
    await expect(page.getByText(CREDENTIALS.email.split("@")[0], { exact: false })).toBeVisible();

    await page.getByRole("button", { name: /sess|proprietário|administrador/i }).first().click();
    await page.getByRole("menuitem", { name: "Sair da conta" }).click();

    await expect(page).toHaveURL(/\/login/);
  });
});
