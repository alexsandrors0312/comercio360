import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email = "gerente.aurora@example.test") {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Entrar na minha loja" }).click();
  await expect(page).toHaveURL(/\/app\/visao-geral/);
}

async function createCustomer(page: Page, name: string) {
  await page.goto("/app/clientes");
  const form = page.getByLabel("Cadastrar cliente", { exact: true });
  await form.getByLabel("Nome do cliente").fill(name);
  await form.getByLabel("Telefone (opcional)").fill("(11) 99999-1234");
  await form.getByLabel("E-mail (opcional)").fill("CLIENTE@example.test");
  await form.getByRole("button", { name: "Cadastrar cliente" }).click();
  await expect(page.getByLabel("Detalhes do cliente")).toContainText(name);
  await expect(page.getByLabel("Detalhes do cliente")).toContainText(
    "11999991234",
  );
  await expect(page.getByLabel("Detalhes do cliente")).toContainText(
    "cliente@example.test",
  );
  return page.url();
}

async function createSku(page: Page, suffix: string) {
  const code = "CLI-" + suffix;
  await page.goto("/app/produtos");
  await page.getByRole("button", { name: "Novo produto" }).click();
  await page.getByLabel("Nome do produto").fill("Cliente venda " + suffix);
  await page.getByLabel("SKU", { exact: true }).fill(code);
  await page.getByRole("button", { name: "Criar produto" }).click();
  await page.getByText("Informar preço", { exact: true }).click();
  await page.getByLabel("Preço em reais para Loja Centro").fill("12,34");
  await page.getByRole("button", { name: "Salvar preço", exact: true }).click();
  await page.goto("/app/estoque?q=" + code);
  await page.getByRole("link", { name: new RegExp("SKU " + code) }).click();
  await page.getByLabel("Tipo de movimentação").selectOption("entry");
  await page.getByLabel("Quantidade (unidades)").fill("5");
  await page
    .getByLabel("Motivo da movimentação")
    .fill("Entrada fictícia Clientes006 " + suffix);
  await page
    .getByRole("button", { name: "Registrar movimentação", exact: true })
    .click();
  await expect(page.getByText("Saldo atual:")).toContainText("5 unidades");
  return code;
}

test("manager creates, searches, edits, inactivates and reactivates a customer", async ({
  page,
}) => {
  await signIn(page);
  const url = await createCustomer(page, "Cliente fictícia fluxo006");
  await page.goto("/app/clientes");
  await page
    .getByLabel("Buscar por nome, telefone ou e-mail")
    .fill("11999991234");
  await page.getByRole("button", { name: "Buscar clientes" }).click();
  await expect(page.getByLabel("Lista de clientes")).toContainText(
    "Cliente fictícia fluxo006",
  );
  await expect(page).not.toHaveURL(/(?:\?|&)q=/);
  await page.goto(url);
  const edit = page.getByLabel("Editar cliente", { exact: true });
  await edit.getByLabel("Nome do cliente").fill("Cliente fictícia alterada006");
  await edit.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByLabel("Detalhes do cliente")).toContainText(
    "Cliente fictícia alterada006",
  );
  await page.getByRole("button", { name: "Inativar cliente" }).click();
  await expect(page.getByLabel("Detalhes do cliente")).toContainText("Inativo");
  await page.getByRole("button", { name: "Reativar cliente" }).click();
  await expect(page.getByLabel("Detalhes do cliente")).toContainText("Ativo");
});

test("sale records customer name snapshot and only this store sees its history", async ({
  page,
}) => {
  await signIn(page);
  const customerUrl = await createCustomer(
    page,
    "Cliente fictícia snapshot006",
  );
  const code = await createSku(page, "SNAPSHOT");
  await page.goto("/app/pdv");
  await page
    .getByLabel("Buscar variante por produto, SKU ou código de barras")
    .fill(code);
  await page.getByRole("button", { name: "Buscar SKU" }).click();
  await page.getByRole("button", { name: "Adicionar " + code }).click();
  await page
    .getByLabel("Buscar cliente por nome, telefone ou e-mail")
    .fill("snapshot006");
  await page.getByRole("button", { name: "Buscar cliente" }).click();
  await page
    .getByRole("button", {
      name: "Selecionar cliente Cliente fictícia snapshot006",
    })
    .click();
  await page
    .getByLabel("Conferi os itens, quantidades e preços desta venda")
    .check();
  await page
    .getByRole("button", { name: "Confirmar venda e baixar estoque" })
    .click();
  await expect(page.getByLabel("Detalhes da venda")).toContainText(
    "Cliente registrado: Cliente fictícia snapshot006",
  );
  await expect(page).toHaveURL(/\/app\/pdv\?.*venda=/);
  const saleUrl = page.url();
  await page.goto(customerUrl);
  await expect(page.getByLabel("Vendas do cliente nesta loja")).toContainText(
    "Venda ",
  );
  const edit = page.getByLabel("Editar cliente", { exact: true });
  await edit
    .getByLabel("Nome do cliente")
    .fill("Cliente fictícia renomeada006");
  await edit.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByLabel("Detalhes do cliente")).toContainText(
    "Cliente fictícia renomeada006",
  );
  await page.goto(saleUrl);
  await expect(page.getByLabel("Detalhes da venda")).toContainText(
    "Cliente registrado: Cliente fictícia snapshot006",
  );
  await page
    .getByLabel("Loja", { exact: true })
    .selectOption("10000000-0000-4000-8000-000000000012");
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/visao-geral/);
  await expect(
    page.locator("main strong").filter({ hasText: "Loja Jardim" }),
  ).toBeVisible();
  await page.goto(customerUrl);
  await expect(page.getByLabel("Vendas do cliente nesta loja")).toContainText(
    "Nenhuma venda deste cliente nesta loja",
  );
});

test("cashier can create and select a customer but cannot edit", async ({
  page,
}) => {
  await signIn(page, "caixa.aurora@example.test");
  await createCustomer(page, "Cliente fictícia caixa006");
  await expect(page.getByLabel("Editar cliente", { exact: true })).toHaveCount(
    0,
  );
  await page.goto("/app/pdv");
  await page
    .getByLabel("Buscar cliente por nome, telefone ou e-mail")
    .fill("caixa006");
  await page.getByRole("button", { name: "Buscar cliente" }).click();
  await expect(
    page.getByRole("button", {
      name: "Selecionar cliente Cliente fictícia caixa006",
    }),
  ).toBeVisible();
});

for (const role of ["comprador", "estoquista"])
  test(`${role} cannot open customer records`, async ({ page }) => {
    await signIn(page, `${role}.aurora@example.test`);
    await page.goto("/app/clientes");
    await expect(
      page.getByRole("heading", { name: "Acesso não permitido" }),
    ).toBeVisible();
  });

test("lost customer-save response survives reload and replays the same attempt", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/app/clientes");
  const form = page.getByLabel("Cadastrar cliente", { exact: true });
  await form.getByLabel("Nome do cliente").fill("Cliente fictícia replay006");
  let intercepted = false;
  await page.route("**/app/clientes*", async (route) => {
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
  await form.getByRole("button", { name: "Cadastrar cliente" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Não foi possível confirmar o resultado" }),
  ).toBeVisible();
  const original = await page.evaluate(() =>
    Object.keys(sessionStorage)
      .filter((key) => key.startsWith("c360:clientes:"))
      .map((key) => sessionStorage.getItem(key)),
  );
  expect(original).toHaveLength(1);
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Envio anterior pendente de confirmação",
    }),
  ).toBeVisible();
  const recovered = await page.evaluate(() =>
    Object.keys(sessionStorage)
      .filter((key) => key.startsWith("c360:clientes:"))
      .map((key) => sessionStorage.getItem(key)),
  );
  expect(recovered).toEqual(original);
  await page.getByRole("button", { name: "Confirmar envio anterior" }).click();
  await expect(page.getByLabel("Detalhes do cliente")).toContainText(
    "Cliente fictícia replay006",
  );
  await expect(
    page.getByRole("heading", {
      name: "Envio anterior pendente de confirmação",
    }),
  ).toHaveCount(0);
  expect(intercepted).toBe(true);
});

for (const width of [360, 768, 1440])
  test(`customer page fits ${width}px and supports keyboard search`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page);
    await page.goto("/app/clientes");
    const search = page.getByLabel("Buscar por nome, telefone ou e-mail");
    await search.fill("Pessoa fictícia");
    await search.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Clientes", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
