import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Entrar na minha loja" }).click();
  await expect(page).toHaveURL(/\/app\/visao-geral/);
}

test("manager searches and reads store price in the catalog", async ({
  page,
}) => {
  await signIn(page, "gerente.aurora@example.test");
  await page.goto("/app/produtos");
  await expect(
    page.getByRole("heading", { name: "Produtos", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("A partir de R$ 59,90")).toBeVisible();
  await page.getByRole("link", { name: /Camiseta básica/ }).click();
  await expect(
    page.getByRole("heading", { name: "Camiseta básica" }),
  ).toBeVisible();
  await expect(page.getByText("CAM-AZ-P", { exact: true })).toBeVisible();
  await expect(page.getByText("R$ 59,90", { exact: true })).toBeVisible();

  await page
    .getByLabel("Buscar por nome, SKU ou código de barras")
    .fill("CAM-AZ-P");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(
    page.getByRole("link", { name: /Camiseta básica/ }),
  ).toBeVisible();
  await page
    .getByLabel("Buscar por nome, SKU ou código de barras")
    .fill("inexistente-002");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Nenhum produto encontrado" }),
  ).toBeVisible();
});

test("cashier can read catalog but cannot edit it", async ({ page }) => {
  await signIn(page, "caixa.aurora@example.test");
  await page.goto("/app/produtos");
  await expect(page.getByText("Camiseta básica")).toBeVisible();
  await expect(page.getByRole("button", { name: "Novo produto" })).toHaveCount(
    0,
  );
  await page.getByRole("link", { name: /Camiseta básica/ }).click();
  await expect(
    page.getByRole("button", { name: "Editar produto" }),
  ).toHaveCount(0);
});

test("manager creates a product and sets its store price", async ({ page }) => {
  await signIn(page, "gerente.aurora@example.test");
  await page.goto("/app/produtos");
  await page.getByRole("button", { name: "Novo produto" }).click();
  await page.getByLabel("Nome do produto").fill("Vestido de teste");
  await page.getByLabel("SKU", { exact: true }).fill("VEST-002");
  await page.getByRole("button", { name: "Criar produto" }).click();
  await expect(
    page.getByRole("heading", { name: "Vestido de teste", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("VEST-002", { exact: true })).toBeVisible();
  await page.getByText("Informar preço", { exact: true }).click();
  await page.getByLabel("Preço em reais para Loja Centro").fill("79,90");
  await page.getByRole("button", { name: "Salvar preço" }).click();
  await expect(page.getByText("R$ 79,90", { exact: true })).toBeVisible();
});

for (const width of [360, 768, 1440]) {
  test(`catalog fits viewport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page, "gerente.aurora@example.test");
    await page.goto("/app/produtos");
    await expect(
      page.getByRole("heading", { name: "Produtos", exact: true }),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  });
}
