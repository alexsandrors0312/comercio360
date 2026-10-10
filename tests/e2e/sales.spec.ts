import { expect, test, type Page } from "@playwright/test";
async function signIn(page: Page, email = "gerente.aurora@example.test") {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Entrar na minha loja" }).click();
  await expect(page).toHaveURL(/\/app\/visao-geral/);
}
async function createSku(
  page: Page,
  suffix: string,
  price: string | null = "12,34",
  quantity = 5,
) {
  const code = "PDV-" + suffix;
  await page.goto("/app/produtos");
  await page.getByRole("button", { name: "Novo produto" }).click();
  await page.getByLabel("Nome do produto").fill("Venda " + suffix);
  await page.getByLabel("SKU", { exact: true }).fill(code);
  await page.getByRole("button", { name: "Criar produto" }).click();
  await expect(
    page.getByRole("heading", { name: "Venda " + suffix, exact: true }),
  ).toBeVisible();
  const catalogUrl = page.url();
  if (price !== null) {
    await page.getByText("Informar preço", { exact: true }).click();
    await page.getByLabel("Preço em reais para Loja Centro").fill(price);
    await page
      .getByRole("button", { name: "Salvar preço", exact: true })
      .click();
    await expect(page.getByText("R$ " + price, { exact: true })).toBeVisible();
  }
  await page.goto("/app/estoque?q=" + code);
  await page.getByRole("link", { name: new RegExp("SKU " + code) }).click();
  if (quantity > 0) {
    await page.getByLabel("Tipo de movimentação").selectOption("entry");
    await page.getByLabel("Quantidade (unidades)").fill(String(quantity));
    await page
      .getByLabel("Motivo da movimentação")
      .fill("Entrada fictícia para PDV005 " + suffix);
    await page
      .getByRole("button", { name: "Registrar movimentação", exact: true })
      .click();
    await expect(page.getByText("Saldo atual:")).toContainText(
      quantity + " unidades",
    );
  }
  return { code, catalogUrl };
}
async function addSku(page: Page, code: string, quantity = "2") {
  await page
    .getByLabel("Buscar variante por produto, SKU ou código de barras")
    .fill(code);
  await page.getByRole("button", { name: "Buscar SKU", exact: true }).click();
  await page
    .getByRole("button", { name: "Adicionar " + code, exact: true })
    .click();
  await page.getByLabel("Quantidade " + code, { exact: true }).fill(quantity);
}
async function confirm(page: Page) {
  await page
    .getByLabel("Conferi os itens, quantidades e preços desta venda")
    .check();
  await page
    .getByRole("button", {
      name: "Confirmar venda e baixar estoque",
      exact: true,
    })
    .click();
}
async function balance(page: Page, code: string, quantity: number) {
  await page.goto("/app/estoque?q=" + code);
  await page.getByRole("link", { name: new RegExp("SKU " + code) }).click();
  await expect(page.getByText("Saldo atual:")).toContainText(
    quantity + " unidades",
  );
}
async function cancel(page: Page) {
  await page
    .getByLabel("Motivo do cancelamento")
    .fill("Retorno integral fictício PDV005");
  await page
    .getByLabel("Confirmo que todas as mercadorias retornaram ao estoque")
    .check();
  await page
    .getByRole("button", {
      name: "Cancelar venda e repor estoque",
      exact: true,
    })
    .click();
}
test("catalog prices and two-line sale update stock, snapshots and full cancellation", async ({
  page,
}) => {
  await signIn(page);
  const first = await createSku(page, "FLUXO1"),
    second = await createSku(page, "FLUXO2", "10,00");
  const pdvLink = page.getByRole("navigation").getByRole("link", { name: "Vendas / PDV", exact: true });
  await expect(pdvLink).toHaveAttribute("href", "/app/pdv");
  await pdvLink.click();
  await expect(page).toHaveURL(/\/app\/pdv$/);
  await expect(pdvLink).toHaveAttribute("aria-current", "page");
  await addSku(page, first.code);
  await addSku(page, second.code, "1");
  await expect(page.getByText("Total revisado:")).toContainText("R$ 34,68");
  await confirm(page);
  await expect(page.getByLabel("Detalhes da venda")).toContainText("R$ 34,68");
  const saleUrl = page.url();
  await balance(page, first.code, 3);
  await expect(page.getByText(/^Venda [0-9a-f-]+$/)).toHaveCount(1);
  await balance(page, second.code, 4);
  await page.goto(saleUrl);
  await cancel(page);
  await expect(page.getByLabel("Detalhes da venda")).toContainText(
    "Cancelada em",
  );
  await expect(page.getByLabel("Detalhes da venda")).toContainText(
    "Retorno integral fictício PDV005",
  );
  await balance(page, first.code, 5);
  await balance(page, second.code, 5);
  await page
    .getByLabel("Loja", { exact: true })
    .selectOption("10000000-0000-4000-8000-000000000012");
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  await expect(page.locator("main strong").filter({ hasText: "Loja Jardim" })).toBeVisible();
  await page.goto(saleUrl);
  await expect(
    page.getByRole("heading", { name: "Selecione uma venda" }),
  ).toBeVisible();
});
test("zero price is sellable and missing store price blocks adding", async ({
  page,
}) => {
  await signIn(page);
  const missing = await createSku(page, "SEMPRECO", null),
    zero = await createSku(page, "ZERO", "0,00");
  await page.goto("/app/pdv");
  await page
    .getByLabel("Buscar variante por produto, SKU ou código de barras")
    .fill(missing.code);
  await page.getByRole("button", { name: "Buscar SKU", exact: true }).click();
  await expect(page.getByText(/Sem preço nesta loja/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Adicionar " + missing.code }),
  ).toBeDisabled();
  await addSku(page, zero.code, "1");
  await confirm(page);
  await expect(page.getByLabel("Detalhes da venda")).toContainText(
    "Total registrado: R$ 0,00",
  );
  await balance(page, zero.code, 4);
});
test("invalid cancellation reason stays editable without a storage failure", async ({
  page,
}) => {
  await signIn(page);
  const product = await createSku(page, "MOTIVO");
  await page.goto("/app/pdv");
  await addSku(page, product.code, "1");
  await confirm(page);
  await expect(page.getByLabel("Detalhes da venda")).toContainText(
    "Total registrado:",
  );
  await page.getByLabel("Motivo do cancelamento").fill("😀😀");
  await page
    .getByLabel("Confirmo que todas as mercadorias retornaram ao estoque")
    .check();
  await page
    .getByRole("button", {
      name: "Cancelar venda e repor estoque",
      exact: true,
    })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "O motivo deve ter de 3 a 240 caracteres" }),
  ).toBeVisible();
  await expect(page.getByLabel("Motivo do cancelamento")).toBeEnabled();
  await expect(
    page.getByText("O armazenamento seguro desta aba está indisponível", {
      exact: false,
    }),
  ).toHaveCount(0);
  await cancel(page);
  await expect(page.getByLabel("Detalhes da venda")).toContainText(
    "Cancelada em",
  );
});
test("insufficient stock refuses the complete multiline sale", async ({
  page,
}) => {
  await signIn(page);
  const enough = await createSku(page, "INTEGRAL1"),
    short = await createSku(page, "INTEGRAL2", "12,34", 1);
  await page.goto("/app/pdv");
  await addSku(page, enough.code);
  await addSku(page, short.code);
  await confirm(page);
  await expect(
    page.getByRole("alert").filter({ hasText: "Saldo insuficiente" }),
  ).toBeVisible();
  await expect(page.getByLabel("Quantidade " + short.code)).toHaveValue("2");
  await balance(page, enough.code, 5);
  await balance(page, short.code, 1);
});
test("catalog price changed after review causes conflict without a stock decrease", async ({
  page,
  context,
}) => {
  await signIn(page);
  const product = await createSku(page, "PRECO");
  await page.goto("/app/pdv");
  await addSku(page, product.code);
  const other = await context.newPage();
  await other.goto(product.catalogUrl);
  await other.getByText("Alterar preço", { exact: true }).click();
  await other.getByLabel("Preço em reais para Loja Centro").fill("15,00");
  await other
    .getByRole("button", { name: "Salvar preço", exact: true })
    .click();
  await expect(other.getByText("R$ 15,00", { exact: true })).toBeVisible();
  await confirm(page);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "O preço, a venda ou esta chave mudou" }),
  ).toBeVisible();
  await balance(page, product.code, 5);
  await other.close();
});
test("cashier confirms without cancel controls or purchase costs", async ({
  page,
  browser,
}) => {
  await signIn(page);
  const product = await createSku(page, "CAIXA");
  const context = await browser.newContext();
  try {
    const cashier = await context.newPage();
    await signIn(cashier, "caixa.aurora@example.test");
    await cashier.goto("/app/pdv");
    await addSku(cashier, product.code, "1");
    await confirm(cashier);
    await expect(cashier.getByLabel("Detalhes da venda")).toContainText(
      "R$ 12,34",
    );
    await expect(
      cashier.getByRole("button", { name: "Cancelar venda e repor estoque" }),
    ).toHaveCount(0);
    await expect(cashier.getByText("Custo unitário")).toHaveCount(0);
    await cashier.goto("/app/compras");
    await expect(
      cashier.getByRole("heading", { name: "Acesso não permitido" }),
    ).toBeVisible();
    await balance(cashier, product.code, 4);
    await expect(
      cashier.getByRole("button", { name: "Registrar movimentação" }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});
for (const role of ["comprador", "estoquista"])
  test(`${role} cannot open PDV`, async ({ page }) => {
    await signIn(page, role + ".aurora@example.test");
    await page.goto("/app/pdv");
    await expect(
      page.getByRole("heading", { name: "Acesso não permitido" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Confirmar venda e baixar estoque" }),
    ).toHaveCount(0);
  });
for (const kind of ["confirm", "cancel"] as const)
  test(`lost ${kind} response survives reload and replays without duplicate stock`, async ({
    page,
  }) => {
    await signIn(page);
    const product = await createSku(page, "REPLAY-" + kind.toUpperCase());
    await page.goto("/app/pdv");
    await addSku(page, product.code);
    if (kind === "cancel") {
      await confirm(page);
      await expect(page.getByLabel("Detalhes da venda")).toContainText(
        "Total registrado:",
      );
    }
    let intercepted = false;
    await page.route("**/app/pdv*", async (route) => {
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
    if (kind === "confirm") await confirm(page);
    else await cancel(page);
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Não foi possível confirmar o resultado" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Confirmar venda e baixar estoque" }),
    ).toBeDisabled();
    const previous = await page.evaluate(() =>
      Object.keys(sessionStorage)
        .filter((key) => key.startsWith("c360:pdv:"))
        .map((key) => sessionStorage.getItem(key)),
    );
    expect(previous).toHaveLength(1);
    await page.reload();
    await expect(
      page.getByRole("heading", {
        name: "Envio anterior pendente de confirmação",
      }),
    ).toBeVisible();
    const recovered = await page.evaluate(() =>
      Object.keys(sessionStorage)
        .filter((key) => key.startsWith("c360:pdv:"))
        .map((key) => sessionStorage.getItem(key)),
    );
    expect(recovered).toEqual(previous);
    await page
      .getByRole("button", { name: "Confirmar envio anterior", exact: true })
      .click();
    await expect(page.getByLabel("Detalhes da venda")).toContainText(
      kind === "confirm" ? "Total registrado:" : "Cancelada em",
    );
    await expect(
      page.getByRole("heading", {
        name: "Envio anterior pendente de confirmação",
      }),
    ).toHaveCount(0);
    await balance(page, product.code, kind === "confirm" ? 3 : 5);
    await expect(
      page.getByText(
        kind === "confirm"
          ? /^Venda [0-9a-f-]+$/
          : /^Cancelamento de venda [0-9a-f-]+$/,
      ),
    ).toHaveCount(1);
    expect(intercepted).toBe(true);
  });
test("unavailable session storage prevents sending a sale", async ({
  page,
}) => {
  await signIn(page);
  const product = await createSku(page, "STORAGE");
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("c360:pdv:"))
        throw new Error("Fictitious storage restriction");
      return original.call(this, key, value);
    };
  });
  await page.goto("/app/pdv");
  await addSku(page, product.code);
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"])
      writes++;
  });
  await confirm(page);
  await expect(
    page
      .getByRole("alert")
      .filter({
        hasText: "O armazenamento seguro desta aba está indisponível",
      }),
  ).toBeVisible();
  expect(writes).toBe(0);
  await expect(
    page.getByRole("button", { name: "Confirmar venda e baixar estoque" }),
  ).toBeDisabled();
  await balance(page, product.code, 5);
});
test("PDV controls stay disabled until delayed hydration and recovery complete", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(60000);
  await signIn(page);
  const context = await browser.newContext({ baseURL });
  let release!: () => void;
  const scriptsReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await context.addCookies(await page.context().cookies());
    await context.route("**/_next/static/**/*.js*", async (route) => {
      await scriptsReady;
      await route.continue().catch(() => {});
    });
    const delayed = await context.newPage();
    await delayed.goto("/app/pdv", { waitUntil: "commit" });
    const input = delayed.getByLabel(
      "Buscar variante por produto, SKU ou código de barras",
    );
    await expect(input).toBeDisabled();
    await expect(
      delayed.getByRole("button", { name: "Buscar SKU", exact: true }),
    ).toBeDisabled();
    await expect(
      delayed.getByLabel("Conferi os itens, quantidades e preços desta venda"),
    ).toBeDisabled();
    release();
    await expect(input).toBeEnabled();
    await expect(
      delayed.getByRole("button", { name: "Buscar SKU", exact: true }),
    ).toBeEnabled();
  } finally {
    release();
    await context.close();
  }
});
for (const width of [360, 768, 1440])
  test(`PDV fits ${width}px with keyboard SKU search`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page);
    await page.goto("/app/pdv");
    const search = page.getByLabel(
      "Buscar variante por produto, SKU ou código de barras",
    );
    await search.fill("CAM-AZ-P");
    await search.press("Enter");
    const add = page.getByRole("button", {
      name: "Adicionar CAM-AZ-P",
      exact: true,
    });
    await add.focus();
    await add.press("Enter");
    await expect(page.getByLabel("Quantidade CAM-AZ-P")).toHaveValue("1");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/pdv-${width}.png`,
      fullPage: true,
    });
  });
