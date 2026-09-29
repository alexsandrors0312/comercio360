import { test, expect, type Page } from "@playwright/test";
async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Entrar na minha loja" }).click();
}
test("active membership without stores is hidden while another organization remains usable", async ({
  page,
}) => {
  await signIn(page, "multiempresa@example.test");
  await expect(page).toHaveURL(/\/app\/visao-geral/);
  const organizations = page.getByLabel("Empresa", { exact: true });
  await expect(organizations.locator("option")).toHaveCount(1);
  await expect(organizations).toContainText("Ateliê Aurora");
  await expect(organizations).not.toContainText("Casa Horizonte");
  await page.context().addCookies([
    {
      name: "c360-org",
      value: "20000000-0000-4000-8000-000000000001",
      domain: "127.0.0.1",
      path: "/",
    },
    {
      name: "c360-store",
      value: "20000000-0000-4000-8000-000000000011",
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
  await page.reload();
  await expect(organizations).toHaveValue(
    "10000000-0000-4000-8000-000000000001",
  );
  await expect(page.getByLabel("Loja", { exact: true })).toHaveValue(
    "10000000-0000-4000-8000-000000000011",
  );
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  await expect(
    page.locator("main strong").filter({ hasText: "Loja Centro" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Empresa", { exact: true }).locator("option"),
  ).toHaveCount(1);
});
test("active membership without any authorized store remains blocked with clear guidance", async ({
  page,
}) => {
  await signIn(page, "sem.loja@example.test");
  await expect(page).toHaveURL(/\/sem-acesso/);
  await expect(
    page.getByText("Ter vínculo com a empresa não libera acesso às lojas.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.goto("/app/estoque");
  await expect(page).toHaveURL(/\/sem-acesso/);
  await expect(page.getByRole("combobox", { name: "Empresa" })).toHaveCount(0);
});
test("valid login, authorized store selection, audited RPC and logout", async ({
  page,
}) => {
  await signIn(page, "gerente.aurora@example.test");
  await expect(page).toHaveURL(/\/app\/visao-geral/);
  await expect(page.getByLabel("Empresa", { exact: true })).toContainText(
    "Ateliê Aurora",
  );
  await expect(page.getByLabel("Empresa", { exact: true })).not.toContainText(
    "Casa Horizonte",
  );
  await page
    .getByLabel("Loja", { exact: true })
    .selectOption("10000000-0000-4000-8000-000000000012");
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(
    page.locator("main strong").filter({ hasText: "Loja Jardim" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Loja", { exact: true })).toHaveValue(
    "10000000-0000-4000-8000-000000000012",
  );
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/app/visao-geral");
  await expect(page).toHaveURL(/\/login/);
});
test("authenticated user without membership is refused", async ({ page }) => {
  await signIn(page, "sem.vinculo@example.test");
  await expect(page).toHaveURL(/\/sem-acesso/);
  await expect(
    page.getByRole("heading", { name: "Acesso ainda não liberado" }),
  ).toBeVisible();
});
test("cashier cannot expand access with a forged cookie", async ({ page }) => {
  await signIn(page, "caixa.aurora@example.test");
  await expect(page).toHaveURL(/\/app\/visao-geral/);
  await expect(
    page.getByLabel("Loja", { exact: true }).locator("option"),
  ).toHaveCount(1);
  await page.context().addCookies([
    {
      name: "c360-org",
      value: "20000000-0000-4000-8000-000000000001",
      domain: "127.0.0.1",
      path: "/",
    },
    {
      name: "c360-store",
      value: "20000000-0000-4000-8000-000000000011",
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
  await page.reload();
  await expect(page.getByLabel("Loja", { exact: true })).toHaveValue(
    "10000000-0000-4000-8000-000000000011",
  );
});
test("invalid login shows an actionable error and does not open protected routes", async ({
  page,
}) => {
  await signIn(page, "unknown@example.test");
  await expect(
    page.getByRole("alert").filter({ hasText: "Não foi possível entrar" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
