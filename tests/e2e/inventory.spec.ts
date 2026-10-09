import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email = "gerente.aurora@example.test") {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Entrar na minha loja" }).click();
  await expect(page).toHaveURL(/\/app\/visao-geral/);
}
async function createSku(page: Page, suffix: string) {
  await page.goto("/app/produtos");
  await page.getByRole("button", { name: "Novo produto" }).click();
  await page.getByLabel("Nome do produto").fill("Estoque " + suffix);
  await page.getByLabel("SKU", { exact: true }).fill("EST-" + suffix);
  await page.getByRole("button", { name: "Criar produto" }).click();
  await expect(
    page.getByRole("heading", { name: "Estoque " + suffix, exact: true }),
  ).toBeVisible();
  await page.goto("/app/estoque?q=EST-" + suffix);
  await page
    .getByRole("link", { name: new RegExp("Estoque " + suffix) })
    .click();
  await expect(page.getByText("Saldo atual:")).toContainText("0 unidades");
}
async function move(
  page: Page,
  kind: "entry" | "exit",
  quantity: string,
  reason: string,
) {
  await page.getByLabel("Tipo de movimentação").selectOption(kind);
  await page.getByLabel("Quantidade (unidades)").fill(quantity);
  await page.getByLabel("Motivo da movimentação").fill(reason);
  await page
    .getByRole("button", { name: "Registrar movimentação", exact: true })
    .click();
}

test("inventory entry, exit, insufficient balance, history, search and store isolation", async ({
  page,
}) => {
  await signIn(page);
  await createSku(page, "FLUXO");
  await move(page, "entry", "10", "Contagem inicial do estoque");
  await expect(page.getByRole("status")).toContainText(
    "Movimentação registrada.",
  );
  await expect(page.getByText("Saldo atual:")).toContainText("10 unidades");
  await expect(
    page.getByText("Contagem inicial do estoque", { exact: true }),
  ).toBeVisible();
  await move(page, "exit", "3", "Ajuste manual justificado");
  await expect(page.getByText("Saldo atual:")).toContainText("7 unidades");
  await expect(
    page.getByText("Ajuste manual justificado", { exact: true }),
  ).toBeVisible();
  await move(page, "exit", "8", "Saída acima do saldo");
  await expect(
    page.getByRole("alert").filter({ hasText: "Saldo insuficiente" }),
  ).toBeVisible();
  await expect(page.getByText("Saldo atual:")).toContainText("7 unidades");
  await expect(page.getByLabel("Quantidade (unidades)")).toHaveValue("8");
  await page
    .getByLabel("Loja", { exact: true })
    .selectOption("10000000-0000-4000-8000-000000000012");
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  await expect(
    page.locator("main strong").filter({ hasText: "Loja Jardim" }),
  ).toBeVisible();
  await page.goto("/app/estoque?q=EST-FLUXO");
  await page.getByRole("link", { name: /Estoque FLUXO/ }).click();
  await expect(page.getByText("Saldo atual:")).toContainText("0 unidades");
  await expect(
    page.getByText("Nenhuma movimentação registrada para este SKU."),
  ).toBeVisible();
  await page.getByLabel("Buscar produto ou SKU").fill("SKU-SEM-RESULTADO");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Nenhum SKU encontrado" }),
  ).toBeVisible();
});

test("cashier reads inventory and cannot see movement controls", async ({
  page,
}) => {
  await signIn(page, "caixa.aurora@example.test");
  await page.goto("/app/estoque?q=CAM-AZ-P");
  await page.getByRole("link", { name: /Camiseta básica/ }).click();
  await expect(
    page.getByRole("heading", { name: "Histórico de movimentações" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Registrar movimentação" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Seu acesso permite consultar saldos e histórico.", {
      exact: false,
    }),
  ).toBeVisible();
});

test("two stale forms do not overwrite stock and conflict requires review", async ({
  page,
  context,
}) => {
  await signIn(page);
  await createSku(page, "CONFLITO");
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(other.getByText("Saldo atual:")).toContainText("0 unidades");
  await move(page, "entry", "4", "Primeira entrada concorrente");
  await expect(page.getByText("Saldo atual:")).toContainText("4 unidades");
  await move(other, "entry", "2", "Formulário com revisão antiga");
  await expect(
    other.getByRole("alert").filter({ hasText: "O saldo mudou" }),
  ).toBeVisible();
  await expect(
    other.getByRole("button", { name: "Registrar movimentação" }),
  ).toBeDisabled();
  await other
    .getByRole("link", { name: "Atualizar saldo e revisar movimentação" })
    .click();
  await expect(other.getByText("Saldo atual:")).toContainText("4 unidades");
  await expect(
    other.getByRole("button", { name: "Registrar movimentação" }),
  ).toBeEnabled();
  await expect(
    other.getByText("Formulário com revisão antiga", { exact: true }),
  ).toHaveCount(0);
  await other.close();
});

test("lost response can be confirmed with the same operation without duplicate stock", async ({
  page,
}) => {
  await signIn(page);
  await createSku(page, "REENVIO");
  let intercepted = false;
  await page.route("**/app/estoque*", async (route) => {
    const request = route.request();
    if (
      !intercepted &&
      request.method() === "POST" &&
      request.headers()["next-action"]
    ) {
      intercepted = true;
      await route.fetch(); // Commit the real local SQL transaction, then lose its HTTP response.
      await route.abort("failed");
    } else await route.continue();
  });
  await move(page, "entry", "6", "Confirmação de envio interrompido");
  await expect(
    page.getByRole("button", { name: "Confirmar envio anterior" }),
  ).toBeVisible();
  await expect(page.getByLabel("Quantidade (unidades)")).toBeDisabled();
  await page.getByRole("button", { name: "Confirmar envio anterior" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Movimentação registrada.",
  );
  await expect(page.getByText("Saldo atual:")).toContainText("6 unidades");
  await expect(
    page.getByText("Confirmação de envio interrompido", { exact: true }),
  ).toHaveCount(1);
  expect(intercepted).toBe(true);
});

for (const width of [360, 768, 1440]) {
  test(`inventory is readable without page overflow at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page);
    await page.goto("/app/estoque?q=CAM-AZ-P");
    await page.getByRole("link", { name: /Camiseta básica/ }).click();
    await expect(page.getByLabel("Motivo da movimentação")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/estoque-${width}.png`,
      fullPage: true,
    });
  });
}
