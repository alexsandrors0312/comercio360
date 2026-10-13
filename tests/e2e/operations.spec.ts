import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email = "gerente.aurora@example.test") {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Entrar na minha loja" }).click();
  await expect(page).toHaveURL(/\/app\/visao-geral/);
}

test("overview and sale report reflect the recorded sale and preserve filters", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  await expect(page.getByLabel("Estado da demonstração")).toHaveCount(0);
  const initial = Number(await page.getByRole("article", { name: "Vendas confirmadas" }).locator("p").textContent());
  const sku = "REL-" + Date.now().toString(36);
  await page.goto("/app/produtos");
  await page.getByRole("button", { name: "Novo produto" }).click();
  await page.getByLabel("Nome do produto").fill("Relatório fictício " + sku);
  await page.getByLabel("SKU", { exact: true }).fill(sku);
  await page.getByRole("button", { name: "Criar produto" }).click();
  await page.getByText("Informar preço", { exact: true }).click();
  await page.getByLabel("Preço em reais para Loja Centro").fill("12,34");
  await page.getByRole("button", { name: "Salvar preço", exact: true }).click();
  await page.goto("/app/estoque?q=" + sku);
  await page.getByRole("link", { name: new RegExp("SKU " + sku) }).click();
  await page.getByLabel("Tipo de movimentação").selectOption("entry");
  await page.getByLabel("Quantidade (unidades)").fill("5");
  await page.getByLabel("Motivo da movimentação").fill("Entrada fictícia de relatório");
  await page.getByRole("button", { name: "Registrar movimentação", exact: true }).click();
  await expect(page.getByText("Saldo atual:")).toContainText("5 unidades");
  await page.goto("/app/pdv");
  await page.getByLabel("Buscar variante por produto, SKU ou código de barras").fill(sku);
  await page.getByRole("button", { name: "Buscar SKU", exact: true }).click();
  await page.getByRole("button", { name: "Adicionar " + sku, exact: true }).click();
  await page.getByLabel("Conferi os itens, quantidades e preços desta venda").check();
  await page.getByRole("button", { name: "Confirmar venda e baixar estoque", exact: true }).click();
  await expect(page).toHaveURL(/venda=/);
  const saleId = new URL(page.url()).searchParams.get("venda")!;
  await page.goto("/app/visao-geral");
  await expect(page.getByRole("article", { name: "Vendas confirmadas" })).toContainText(String(initial + 1));
  await expect(page.getByLabel("Últimas vendas confirmadas")).toContainText(saleId);
  await page.getByRole("article", { name: "Vendas confirmadas" }).getByRole("link").click();
  await expect(page.getByLabel("Estado da venda")).toHaveValue("confirmed");
  await expect(page.getByLabel("Resultado do relatório")).toContainText(saleId);
  await page.getByLabel("Consulta", { exact: true }).selectOption("stock");
  await page.getByLabel("Produto ou SKU (consulta de estoque)").fill(sku);
  await page.getByRole("button", { name: "Consultar relatório" }).click();
  await expect(page.getByLabel("Resultado do relatório")).toContainText("4 unidades");
  await page.getByLabel("Loja", { exact: true }).selectOption({ label: "Loja Jardim" });
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  await expect(page.locator("main strong").filter({ hasText: "Loja Jardim" })).toBeVisible();
  await page.goto("/app/relatorios?tipo=stock&q=" + sku);
  await expect(page.getByLabel("Resultado do relatório")).toContainText(sku);
  await expect(page.getByLabel("Resultado do relatório")).toContainText("0 unidades");
  await expect(page.getByLabel("Resultado do relatório")).not.toContainText("4 unidades");
});

for (const role of ["estoquista", "comprador"]) {
  test(`${role} sees stock and cannot force sale reports by URL`, async ({ page }) => {
    await signIn(page, `${role}.aurora@example.test`);
    await expect(page.getByRole("article", { name: "Vendas confirmadas" })).toHaveCount(0);
    await expect(page.getByRole("article", { name: "SKUs consultáveis" })).toBeVisible();
    await page.goto("/app/relatorios");
    await expect(page.getByLabel("Consulta", { exact: true })).toHaveValue("stock");
    await page.goto("/app/relatorios?tipo=sales");
    await expect(page.getByRole("heading", { name: "Acesso não permitido" })).toBeVisible();
  });
}

test("report rejects invalid pagination and does not expose provider errors", async ({ page }) => {
  await signIn(page);
  await page.goto("/app/relatorios?pagina=-1");
  await expect(page.getByRole("heading", { name: "Filtro inválido" })).toBeVisible();
  await expect(page.getByText("Confira o tipo, o filtro e a página do relatório.")).toBeVisible();
});

for (const width of [360, 768, 1440]) {
  test(`operational overview and reports fit ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page);
    for (const route of ["visao-geral", "relatorios"]) {
      await page.goto("/app/" + route);
      await expect(route === "visao-geral"
        ? page.getByRole("article", { name: "SKUs consultáveis" })
        : page.getByLabel("Resultado do relatório")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${route}-${width}.png`), fullPage: true, caret: "initial" });
    }
  });
}
