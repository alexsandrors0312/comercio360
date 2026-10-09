import { expect, test, type Page } from "@playwright/test";
async function signIn(page: Page, email = "gerente.aurora@example.test") {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Entrar na minha loja" }).click();
  await expect(page).toHaveURL(/\/app\/visao-geral/);
}
async function sku(page: Page, suffix: string) {
  await page.goto("/app/produtos");
  await page.getByRole("button", { name: "Novo produto" }).click();
  await page.getByLabel("Nome do produto").fill("Compra " + suffix);
  await page.getByLabel("SKU", { exact: true }).fill("COM-" + suffix);
  await page.getByRole("button", { name: "Criar produto" }).click();
  await expect(
    page.getByRole("heading", { name: "Compra " + suffix, exact: true }),
  ).toBeVisible();
  return "COM-" + suffix;
}
async function supplier(page: Page, suffix: string) {
  const name = "Fornecedor " + suffix;
  await page.goto("/app/compras");
  await page.getByText("Cadastrar novo fornecedor", { exact: true }).click();
  await page.getByLabel("Nome do fornecedor", { exact: true }).fill(name);
  await page
    .getByRole("button", { name: "Cadastrar fornecedor", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Fornecedor salvo." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Novo pedido", exact: true }),
  ).toBeVisible();
  return name;
}
async function purchase(page: Page, name: string, skus: string[]) {
  await page.getByRole("button", { name: "Novo pedido", exact: true }).click();
  for (const code of skus) {
    await page.getByLabel("Buscar variante por produto ou SKU").fill(code);
    await page.getByRole("button", { name: "Buscar SKU", exact: true }).click();
    await page
      .getByRole("button", { name: "Adicionar " + code, exact: true })
      .click();
    await page.getByLabel("Quantidade " + code, { exact: true }).fill("3");
    await page
      .getByLabel("Custo unitário " + code, { exact: true })
      .fill("12,34");
  }
  await page.getByLabel("Fornecedor do pedido").selectOption({ label: name });
  await page.getByRole("button", { name: "Criar pedido", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Pedido de " + name, exact: true }),
  ).toBeVisible();
  return page.url();
}
async function receive(page: Page) {
  await page.getByLabel("Conferi todas as quantidades do pedido").check();
  await page
    .getByRole("button", { name: "Receber pedido completo", exact: true })
    .click();
}
async function balance(page: Page, code: string, quantity: number) {
  await page.goto("/app/estoque?q=" + code);
  await page.getByRole("link", { name: new RegExp("SKU " + code) }).click();
  await expect(page.getByText("Saldo atual:")).toContainText(
    quantity + " unidades",
  );
}
test("supplier, two-line order and full receiving update only the current store", async ({
  page,
}) => {
  await signIn(page);
  const codes = [await sku(page, "FLUXO1"), await sku(page, "FLUXO2")];
  const name = await supplier(page, "FLUXO");
  const orderUrl = await purchase(page, name, codes);
  await expect(page.getByLabel("Detalhes do pedido")).toContainText("R$ 74,04");
  await page.getByText("Editar " + name, { exact: true }).click();
  const editor = page.getByRole("form", {
    name: "Editar fornecedor " + name,
    exact: true,
  });
  await editor
    .getByLabel("Fornecedor ativo — " + name, { exact: true })
    .uncheck();
  await editor.getByRole("button", { name: "Salvar fornecedor" }).click();
  await expect(editor.getByRole("status")).toContainText("Fornecedor salvo.");
  await receive(page);
  await expect(page.getByLabel("Detalhes do pedido")).toContainText(
    "Recebido em",
  );
  await expect(
    page.getByRole("button", { name: "Receber pedido completo" }),
  ).toHaveCount(0);
  for (const code of codes) {
    await balance(page, code, 3);
    await expect(page.getByText(/Recebimento de compra /)).toHaveCount(1);
  }
  await page
    .getByLabel("Loja", { exact: true })
    .selectOption("10000000-0000-4000-8000-000000000012");
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  await expect(
    page.locator("main strong").filter({ hasText: "Loja Jardim" }),
  ).toBeVisible();
  await balance(page, codes[0], 0);
  await page.goto(orderUrl);
  await expect(
    page.getByRole("heading", { name: "Selecione um pedido" }),
  ).toBeVisible();
});
test("cancellation keeps stock unchanged and records the reason", async ({
  page,
}) => {
  await signIn(page);
  const code = await sku(page, "CANCELAR");
  const name = await supplier(page, "CANCELAR");
  await purchase(page, name, [code]);
  await page
    .getByLabel("Motivo do cancelamento")
    .fill("Pedido duplicado de teste");
  await page
    .getByRole("button", { name: "Cancelar pedido", exact: true })
    .click();
  await expect(page.getByLabel("Detalhes do pedido")).toContainText(
    "Motivo do cancelamento: Pedido duplicado de teste",
  );
  await expect(
    page.getByRole("button", { name: "Receber pedido completo" }),
  ).toHaveCount(0);
  await balance(page, code, 0);
});
test("stale cancellation cannot overwrite a received order", async ({
  page,
  context,
}) => {
  await signIn(page);
  const code = await sku(page, "CONFLITO");
  const name = await supplier(page, "CONFLITO");
  const url = await purchase(page, name, [code]);
  const other = await context.newPage();
  await other.goto(url);
  await expect(other.getByLabel("Motivo do cancelamento")).toBeVisible();
  await receive(page);
  await expect(page.getByLabel("Detalhes do pedido")).toContainText(
    "Recebido em",
  );
  await other
    .getByLabel("Motivo do cancelamento")
    .fill("Tentativa desatualizada");
  await other
    .getByRole("button", { name: "Cancelar pedido", exact: true })
    .click();
  await expect(
    other
      .getByRole("alert")
      .filter({ hasText: "O pedido ou fornecedor mudou" }),
  ).toBeVisible();
  await other
    .getByRole("link", { name: "Atualizar e revisar os dados" })
    .click();
  await expect(other.getByLabel("Detalhes do pedido")).toContainText(
    "Recebido em",
  );
  await other.close();
});
test("lost receiving response is confirmed without duplicate inventory", async ({
  page,
}) => {
  await signIn(page);
  const code = await sku(page, "REENVIO");
  const name = await supplier(page, "REENVIO");
  await purchase(page, name, [code]);
  let intercepted = false;
  await page.route("**/app/compras*", async (route) => {
    if (
      !intercepted &&
      route.request().method() === "POST" &&
      route.request().headers()["next-action"]
    ) {
      intercepted = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await receive(page);
  await expect(
    page.getByRole("button", { name: "Confirmar envio anterior" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirmar envio anterior" }).click();
  await expect(page.getByLabel("Detalhes do pedido")).toContainText(
    "Recebido em",
  );
  await balance(page, code, 3);
  await expect(page.getByText(/Recebimento de compra /)).toHaveCount(1);
  expect(intercepted).toBe(true);
});
test("stockist receives but cannot manage suppliers or cancel", async ({
  page,
  browser,
}) => {
  await signIn(page);
  const code = await sku(page, "ESTOQUISTA");
  const name = await supplier(page, "ESTOQUISTA");
  const url = await purchase(page, name, [code]);
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  try {
    await signIn(other, "estoquista.aurora@example.test");
    await other.goto(url);
    await expect(
      other.getByRole("heading", { name: "Pedido de " + name }),
    ).toBeVisible();
    await expect(
      other.getByRole("button", { name: "Novo pedido", exact: true }),
    ).toHaveCount(0);
    await expect(
      other.getByRole("button", { name: "Cancelar pedido", exact: true }),
    ).toHaveCount(0);
    await expect(
      other.getByText("Cadastrar novo fornecedor", { exact: true }),
    ).toHaveCount(0);
    await receive(other);
    await expect(other.getByLabel("Detalhes do pedido")).toContainText(
      "Recebido em",
    );
    await balance(other, code, 3);
  } finally {
    await otherContext.close();
  }
});
test("supplier draft keeps its original revision after an unrelated refresh", async ({
  page,
  context,
}) => {
  await signIn(page);
  const name = await supplier(page, "REVISAO");
  await page.getByText("Editar " + name, { exact: true }).click();
  await page
    .getByRole("form", { name: "Editar fornecedor " + name, exact: true })
    .getByLabel("Contato de " + name)
    .fill("Rascunho antigo preservado");
  const other = await context.newPage();
  await other.goto("/app/compras");
  await other.getByText("Editar " + name, { exact: true }).click();
  const newerName = name + " atualizado";
  const otherEditor = other.getByRole("form", {
    name: "Editar fornecedor " + name,
    exact: true,
  });
  await otherEditor.getByLabel("Nome de " + name).fill(newerName);
  await otherEditor.getByRole("button", { name: "Salvar fornecedor" }).click();
  await expect(
    other
      .getByRole("form", {
        name: "Editar fornecedor " + newerName,
        exact: true,
      })
      .getByRole("status"),
  ).toContainText("Fornecedor salvo.");
  await page
    .getByLabel("Nome do fornecedor", { exact: true })
    .fill("Fornecedor disparador do refresh");
  await page
    .getByRole("button", { name: "Cadastrar fornecedor", exact: true })
    .click();
  const oldEditor = page.getByRole("form", {
    name: "Editar fornecedor " + newerName,
    exact: true,
  });
  await expect(oldEditor.getByLabel("Contato de " + newerName)).toHaveValue(
    "Rascunho antigo preservado",
  );
  await oldEditor.getByRole("button", { name: "Salvar fornecedor" }).click();
  await expect(oldEditor.getByRole("alert")).toContainText(
    "O pedido ou fornecedor mudou",
  );
  await other.reload();
  await expect(
    other.getByText("Editar " + newerName, { exact: true }),
  ).toBeVisible();
  await other.close();
});
test("cashier cannot open purchase costs", async ({ page }) => {
  await signIn(page, "caixa.aurora@example.test");
  await page.goto("/app/compras");
  await expect(
    page.getByRole("heading", { name: "Acesso não permitido" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Novo pedido", exact: true }),
  ).toHaveCount(0);
});
test("buyer creates an order but cannot receive it", async ({ page }) => {
  await signIn(page, "comprador.aurora@example.test");
  const name = await supplier(page, "COMPRADOR");
  await purchase(page, name, ["CAM-AZ-P"]);
  await expect(
    page.getByRole("button", { name: "Receber pedido completo" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Cancelar pedido", exact: true }),
  ).toBeVisible();
});
for (const width of [360, 768, 1440]) {
  test(`procurement forms fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page);
    await page.goto("/app/compras");
    await page
      .getByRole("button", { name: "Novo pedido", exact: true })
      .click();
    await page
      .getByLabel("Buscar variante por produto ou SKU")
      .fill("CAM-AZ-P");
    await page.getByRole("button", { name: "Buscar SKU", exact: true }).click();
    await page
      .getByRole("button", { name: "Adicionar CAM-AZ-P", exact: true })
      .click();
    await page
      .getByLabel("Custo unitário CAM-AZ-P", { exact: true })
      .fill("9,99");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `test-results/compras-${width}.png`,
      fullPage: true,
    });
  });
}
