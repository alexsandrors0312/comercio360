import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email = "gerente.aurora@example.test") {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Entrar na minha loja" }).click();
  await expect(page).toHaveURL(/\/app\/visao-geral/);
}

async function createSku(page: Page, suffix: string) {
  const sku = "PED-" + suffix;
  await page.goto("/app/produtos");
  await page.getByRole("button", { name: "Novo produto" }).click();
  await page.getByLabel("Nome do produto").fill("Pedido fictício " + suffix);
  await page.getByLabel("SKU", { exact: true }).fill(sku);
  await page.getByRole("button", { name: "Criar produto" }).click();
  await page.getByText("Informar preço", { exact: true }).click();
  await page.getByLabel("Preço em reais para Loja Centro").fill("12,34");
  await page.getByRole("button", { name: "Salvar preço", exact: true }).click();
  await page.goto("/app/estoque?q=" + sku);
  await page.getByRole("link", { name: new RegExp("SKU " + sku) }).click();
  await page.getByLabel("Tipo de movimentação").selectOption("entry");
  await page.getByLabel("Quantidade (unidades)").fill("5");
  await page.getByLabel("Motivo da movimentação").fill("Entrada fictícia Pedidos007 " + suffix);
  await page.getByRole("button", { name: "Registrar movimentação", exact: true }).click();
  await expect(page.getByText("Saldo atual:")).toContainText("5 unidades");
  return sku;
}

async function createCustomer(page: Page, suffix: string) {
  const name = "Cliente pedido fictício " + suffix;
  await page.goto("/app/clientes");
  const form = page.getByLabel("Cadastrar cliente", { exact: true });
  await form.getByLabel("Nome do cliente").fill(name);
  await form.getByLabel("Telefone (opcional)").fill("(11) 99999-1234");
  await form.getByRole("button", { name: "Cadastrar cliente" }).click();
  await expect(page.getByLabel("Detalhes do cliente")).toContainText(name);
  return name;
}

async function addSkuToOrder(page: Page, sku: string) {
  await page.getByLabel("Buscar variante por produto, SKU ou código de barras").fill(sku);
  await page.getByRole("button", { name: "Buscar SKU" }).click();
  await page.getByRole("button", { name: "Adicionar " + sku }).click();
  await expect(page.getByLabel("Criar pedido")).toContainText(sku);
}

async function registerCounterOrder(page: Page, sku: string) {
  await page.goto("/app/pedidos");
  await addSkuToOrder(page, sku);
  await page.getByLabel("Conferi os itens, as quantidades e os preços do pedido").check();
  await page.getByRole("button", { name: "Registrar pedido" }).click();
  await expect(page).toHaveURL(/\/app\/pedidos\?pedido=/);
  await expect(page.getByLabel("Detalhes do pedido")).toContainText(sku);
  return new URL(page.url()).searchParams.get("pedido")!;
}

test("manager captures a manual WhatsApp order and concludes it as one sale", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  const suffix = Date.now().toString(36);
  const sku = await createSku(page, suffix);
  const customer = await createCustomer(page, suffix);
  await page.goto("/app/pedidos");
  await page.getByLabel("Origem do pedido").selectOption("whatsapp");
  await expect(page.getByRole("button", { name: "Registrar pedido" })).toBeDisabled();
  await addSkuToOrder(page, sku);
  await page.getByLabel("Buscar cliente por nome, telefone ou e-mail").fill(suffix);
  await page.getByRole("button", { name: "Buscar cliente" }).click();
  await page.getByRole("button", { name: "Selecionar cliente " + customer }).click();
  await page.getByLabel("Conferi os itens, as quantidades e os preços do pedido").check();
  await page.getByRole("button", { name: "Registrar pedido" }).click();
  await expect(page.getByLabel("Detalhes do pedido")).toContainText(customer);
  await expect(page.getByLabel("Detalhes do pedido")).toContainText("WhatsApp manual");
  await expect(page).toHaveURL(/\/app\/pedidos\?pedido=/);
  await page.getByLabel("Conferi os itens e vou confirmar a venda com baixa de estoque").check();
  await page.getByRole("button", { name: "Concluir pedido em venda" }).click();
  await expect(page.getByLabel("Detalhes do pedido")).toContainText("Concluído em venda");
  const sale = page.getByLabel("Detalhes do pedido").getByRole("link", { name: /[a-f0-9-]{36}/ });
  await expect(sale).toBeVisible();
  await sale.click();
  await expect(page.getByLabel("Detalhes da venda")).toContainText(sku);
});

test("lost create response keeps the same order attempt in this tab for replay", async ({ page }) => {
  await signIn(page);
  const sku = await createSku(page, Date.now().toString(36));
  await page.goto("/app/pedidos");
  await addSkuToOrder(page, sku);
  await page.getByLabel("Conferi os itens, as quantidades e os preços do pedido").check();
  let intercepted = false;
  await page.route("**/app/pedidos*", async (route) => {
    if (!intercepted && route.request().method() === "POST" && route.request().headers()["next-action"]) {
      intercepted = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Registrar pedido" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Não foi possível confirmar o resultado" })).toBeVisible();
  const original = await page.evaluate(() => Object.keys(sessionStorage)
    .filter((key) => key.startsWith("c360:pedidos:"))
    .map((key) => sessionStorage.getItem(key)));
  expect(original).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Envio anterior pendente de confirmação" })).toBeVisible();
  const recovered = await page.evaluate(() => Object.keys(sessionStorage)
    .filter((key) => key.startsWith("c360:pedidos:"))
    .map((key) => sessionStorage.getItem(key)));
  expect(recovered).toEqual(original);
  await page.getByRole("button", { name: "Confirmar envio anterior" }).click();
  await expect(page.getByLabel("Detalhes do pedido")).toContainText(sku);
  expect(intercepted).toBe(true);
});

for (const role of ["comprador", "estoquista"])
  test(`${role} cannot consult orders`, async ({ page }) => {
    await signIn(page, `${role}.aurora@example.test`);
    await page.goto("/app/pedidos");
    await expect(page.getByRole("heading", { name: "Acesso não permitido" })).toBeVisible();
  });

test("cashier can capture and conclude but cannot cancel an order", async ({ page }) => {
  await signIn(page);
  const sku = await createSku(page, Date.now().toString(36));
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await signIn(page, "caixa.aurora@example.test");
  await registerCounterOrder(page, sku);
  await expect(page.getByLabel("Capturar pedido")).toBeVisible();
  await expect(page.getByLabel("Consulta de pedidos")).toBeVisible();
  await expect(page.getByLabel("Cancelar pedido")).toHaveCount(0);
  await page.getByLabel("Conferi os itens e vou confirmar a venda com baixa de estoque").check();
  await page.getByRole("button", { name: "Concluir pedido em venda" }).click();
  await expect(page.getByLabel("Detalhes do pedido")).toContainText("Concluído em venda");
});

test("cancel keeps stock and the visible filter matches its list after opening a detail", async ({ page }) => {
  await signIn(page);
  const sku = await createSku(page, Date.now().toString(36));
  const cancelledId = await registerCounterOrder(page, sku);
  await page.getByLabel("Motivo do cancelamento").fill("Desistência fictícia do atendimento");
  await page.getByRole("button", { name: "Cancelar pedido", exact: true }).click();
  await expect(page.getByLabel("Detalhes do pedido")).toContainText("Cancelado");
  await registerCounterOrder(page, sku);
  await page.goto("/app/pedidos");
  await page.getByLabel("Estado do pedido").selectOption("cancelled");
  await page.getByRole("button", { name: "Filtrar pedidos", exact: true }).click();
  const list = page.getByLabel("Lista de pedidos", { exact: true });
  await expect(list.getByRole("link").filter({ hasText: "Aberto" })).toHaveCount(0);
  await list.getByRole("link", { name: new RegExp(cancelledId) }).click();
  await expect(page.getByLabel("Estado do pedido")).toHaveValue("all");
  await expect(list.getByRole("link").filter({ hasText: "Aberto" }).first()).toBeVisible();
  await page.goto("/app/estoque?q=" + sku);
  await page.getByRole("link", { name: new RegExp("SKU " + sku) }).click();
  await expect(page.getByText("Saldo atual:")).toContainText("5 unidades");
});

test("lost fulfillment response replays one sale after reload", async ({ page }) => {
  await signIn(page);
  const sku = await createSku(page, Date.now().toString(36));
  const orderId = await registerCounterOrder(page, sku);
  let intercepted = false;
  await page.route("**/app/pedidos*", async (route) => {
    if (!intercepted && route.request().method() === "POST" && route.request().headers()["next-action"]) {
      intercepted = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByLabel("Conferi os itens e vou confirmar a venda com baixa de estoque").check();
  await page.getByRole("button", { name: "Concluir pedido em venda" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Não foi possível confirmar o resultado" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Envio anterior pendente de confirmação" })).toBeVisible();
  const saleHref = await page.getByLabel("Detalhes do pedido").getByRole("link").getAttribute("href");
  await page.getByRole("button", { name: "Confirmar envio anterior" }).click();
  await expect(page.getByRole("heading", { name: "Envio anterior pendente de confirmação" })).toHaveCount(0);
  await expect(page.getByLabel("Detalhes do pedido").getByRole("link")).toHaveAttribute("href", saleHref!);
  await expect(page).toHaveURL(new RegExp(orderId));
  await page.goto("/app/estoque?q=" + sku);
  await page.getByRole("link", { name: new RegExp("SKU " + sku) }).click();
  await expect(page.getByText("Saldo atual:")).toContainText("4 unidades");
  expect(intercepted).toBe(true);
});

for (const width of [360, 768, 1440])
  test(`orders fit ${width}px and support keyboard filtering`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page);
    await page.goto("/app/pedidos");
    await page.getByLabel("Estado do pedido").selectOption("open");
    await page.getByLabel("Estado do pedido").press("Enter");
    await expect(page.getByRole("heading", { name: "Pedidos", exact: true })).toBeVisible();
    await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0); });
    await page.screenshot({ path: testInfo.outputPath(`orders-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
