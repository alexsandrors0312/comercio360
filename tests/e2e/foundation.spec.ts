import { test, expect } from "@playwright/test";
for (const width of [360, 768, 1440]) {
  test(`navigation and demo states at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/demo");
    await expect(
      page.getByRole("heading", { name: "Visão Geral." }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.getByLabel("Estado da demonstração").selectOption("loading");
    await expect(page.getByLabel("Carregando visão geral")).toBeVisible();
    await page.getByLabel("Estado da demonstração").selectOption("empty");
    await expect(
      page.getByRole("heading", { name: "Nenhum movimento neste período" }),
    ).toBeVisible();
    await page.getByLabel("Estado da demonstração").selectOption("error");
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Não foi possível carregar os indicadores" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Tentar novamente" }).click();
    if (width < 768)
      await page.getByRole("button", { name: "Abrir menu" }).click();
    await page
      .getByRole("navigation")
      .getByRole("link", { name: "Vendas / PDV" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Em construção" }),
    ).toBeVisible();
  });
}
test("protected routes require a real session; demo cannot grant access", async ({
  page,
}) => {
  await page.goto("/demo");
  await page.goto("/app/visao-geral");
  await expect(page).toHaveURL(/\/login/);
  await page.context().addCookies([
    { name: "c360-org", value: "forged", domain: "127.0.0.1", path: "/" },
    { name: "c360-store", value: "forged", domain: "127.0.0.1", path: "/" },
  ]);
  await page.goto("/app/estoque");
  await expect(page).toHaveURL(/\/login/);
});
test("demo context selection is explicit and navigation has no fake operations", async ({
  page,
}) => {
  await page.goto("/demo");
  await page.getByLabel("Empresa", { exact: true }).selectOption("demo-b");
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(
    page.getByText("Loja Vila Nova", { exact: true }).last(),
  ).toBeVisible();
  for (const slug of [
    "vendas",
    "pedidos",
    "produtos",
    "estoque",
    "compras",
    "clientes",
    "entregas",
    "marketing",
    "financeiro",
    "relatorios",
    "configuracoes",
  ]) {
    await page.goto(`/demo/${slug}`);
    await expect(
      page.getByRole("heading", { name: "Em construção" }),
    ).toBeVisible();
  }
  await page.goto("/demo/nonexistent");
  await expect(page.getByText("404", { exact: true })).toBeVisible();
});
