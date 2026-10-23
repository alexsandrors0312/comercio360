import { expect, test } from "@playwright/test";

test("venda fictícia alimenta financeiro, entrega e calendário sem integração externa", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill("gerente.aurora@example.test");
  await page.getByLabel("Senha", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Entrar na minha loja" }).click();
  await expect(page).toHaveURL(/\/app\/visao-geral/);

  const sku = "MANUAL-" + Date.now().toString(36);
  await page.goto("/app/produtos");
  await page.getByRole("button", { name: "Novo produto" }).click();
  await page.getByLabel("Nome do produto").fill("Produto " + sku);
  await page.getByLabel("SKU", { exact: true }).fill(sku);
  await page.getByRole("button", { name: "Criar produto" }).click();
  await expect(page.getByRole("heading", { name: "Produto " + sku, exact: true })).toBeVisible();
  await page.getByText("Informar preço", { exact: true }).click();
  await page.getByLabel("Preço em reais para Loja Centro").fill("12,34");
  await page.getByRole("button", { name: "Salvar preço", exact: true }).click();
  await expect(page.getByText("R$ 12,34", { exact: true })).toBeVisible();

  await page.goto("/app/estoque?q=" + sku);
  await page.getByRole("link", { name: new RegExp("SKU " + sku) }).click();
  await page.getByLabel("Quantidade (unidades)").fill("2");
  await page.getByLabel("Motivo da movimentação").fill("Carga fictícia para módulos manuais");
  await page.getByRole("button", { name: "Registrar movimentação", exact: true }).click();
  await expect(page.getByText("Saldo atual:")).toContainText("2 unidades");

  await page.goto("/app/pdv");
  await page.getByLabel("Buscar variante por produto, SKU ou código de barras").fill(sku);
  await page.getByRole("button", { name: "Buscar SKU", exact: true }).click();
  await page.getByRole("button", { name: "Adicionar " + sku }).click();
  await page.getByLabel("Conferi os itens, quantidades e preços desta venda").check();
  await page.getByRole("button", { name: "Confirmar venda e baixar estoque" }).click();
  await expect(page.getByLabel("Detalhes da venda")).toContainText("R$ 12,34");

  await page.goto("/app/financeiro");
  await expect(page.getByRole("heading", { name: "Financeiro manual" })).toBeVisible();
  const receipt = page.getByRole("heading", { name: "Registrar recebimento" }).locator("..");
  await receipt.getByLabel("Valor em R$").fill("5,00");
  await receipt.getByRole("button", { name: "Registrar recebimento" }).click();
  await expect(page.getByText("Operação confirmada.")).toBeVisible();
  await expect(page.getByText("Recebido R$ 5,00 · Confirmada", { exact: true })).toBeVisible();

  await page.goto("/app/entregas");
  await expect(page.getByRole("heading", { name: "Entregas e retiradas" })).toBeVisible();
  await page.getByRole("button", { name: "Cadastrar acompanhamento" }).click();
  await expect(page.getByText("Operação confirmada.")).toBeVisible();
  await expect(page.getByText("Na fila", { exact: true })).toBeVisible();

  await page.goto("/app/marketing");
  await expect(page.getByRole("heading", { name: "Calendário de marketing" })).toBeVisible();
  await page.getByLabel("Título").fill("Campanha fictícia de teste");
  await page.getByLabel("Data e hora").fill("2026-11-01T09:00");
  await page.getByRole("button", { name: "Criar rascunho" }).click();
  await expect(page.getByText("Operação confirmada.")).toBeVisible();
  await expect(page.getByText("Campanha fictícia de teste")).toBeVisible();
});
