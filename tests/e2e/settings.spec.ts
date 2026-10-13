import { expect, test, type Page } from "@playwright/test";
const password = "test-password-only";
function email(tag: string) {
  return (
    tag +
    "-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 7) +
    "@example.test"
  );
}
async function login(page: Page, address: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(address);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar na minha loja" }).click();
  await expect(page).toHaveURL(/\/app\/visao-geral|\/sem-acesso/);
}
async function signup(page: Page, tag: string) {
  const address = email(tag);
  await page.goto("/cadastro");
  await page.getByLabel("Email", { exact: true }).fill(address);
  await page.getByLabel("Senha (12 a 128 caracteres)").fill(password);
  await page.getByRole("button", { name: "Criar minha conta" }).click();
  await expect(page.getByRole("status")).toContainText("Solicitação recebida");
  await login(page, address);
  await expect(page).toHaveURL(/sem-acesso/);
  return address;
}
async function onboard(page: Page, tag: string) {
  await signup(page, tag);
  await page
    .getByRole("link", { name: "Cadastrar empresa", exact: true })
    .click();
  await page.getByLabel("Seu nome de exibição").fill("Proprietário " + tag);
  await page
    .getByLabel("Nome da empresa", { exact: true })
    .fill("Empresa " + tag);
  await page.getByLabel("Nome da primeira loja").fill("Loja inicial");
  await page
    .getByRole("button", { name: "Criar empresa e primeira loja" })
    .click();
  await expect(page).toHaveURL(/app\/configuracoes/);
  await expect(
    page.getByRole("heading", { name: "Usuários da empresa" }),
  ).toBeVisible();
}
async function createStore(page: Page, name: string) {
  await page.getByLabel("Nome da nova loja").fill(name);
  await page
    .getByRole("button", { name: "Cadastrar loja", exact: true })
    .click();
  await expect(
    page.getByRole("form", { name: "Editar loja " + name }),
  ).toBeVisible();
}
test("owner onboards and manages names, explicit stores and last-store protection", async ({
  page,
}) => {
  await onboard(page, "administracao");
  const first = page.getByRole("form", { name: "Editar loja Loja inicial" });
  await first.getByLabel("Loja ativa").uncheck();
  await first.getByRole("button", { name: "Salvar loja" }).click();
  await expect(page.getByRole("status")).toContainText(
    "O registro mudou ou já existe",
  );
  await page.reload();
  await expect(
    page
      .getByRole("form", { name: "Editar loja Loja inicial" })
      .getByLabel("Loja ativa"),
  ).toBeChecked();
  await createStore(page, "Loja secundária");
  await page
    .getByLabel("Nome da empresa", { exact: true })
    .fill("Empresa renomeada");
  await page.getByRole("button", { name: "Salvar empresa" }).click();
  await expect(
    page.getByText("ADMINISTRAÇÃO · Empresa renomeada"),
  ).toBeVisible();
  const second = page.getByRole("form", {
    name: "Editar loja Loja secundária",
  });
  await second.getByLabel("Loja ativa").uncheck();
  await second.getByRole("button", { name: "Salvar loja" }).click();
  await expect(
    page
      .getByRole("form", { name: "Editar loja Loja secundária" })
      .getByLabel("Loja ativa"),
  ).not.toBeChecked();
  await expect(
    page
      .getByLabel("Loja", { exact: true })
      .getByRole("option", { name: "Loja secundária" }),
  ).toHaveCount(0);
});
test("manual invite grants one store and owner revocation affects an already open session", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  await onboard(page, "convite");
  await createStore(page, "Loja convidada");
  const context = await browser.newContext();
  const guest = await context.newPage();
  try {
    const address = await signup(guest, "convidado");
    const form = page.getByRole("form", { name: "Criar convite" });
    await form.getByLabel("Email do convidado").fill(address);
    await form.getByLabel("Loja convidada", { exact: true }).check();
    await form.getByRole("button", { name: "Gerar convite manual" }).click();
    const code = await page
      .getByLabel("Código do convite", { exact: true })
      .textContent();
    expect(code).toBeTruthy();
    expect(page.url()).not.toContain(code!);
    await guest.getByRole("link", { name: "Aceitar convite manual" }).click();
    await guest.getByLabel("Seu nome de exibição").fill("Pessoa convidada");
    await guest.getByLabel("Código do convite", { exact: true }).fill(code!);
    await guest.getByRole("button", { name: "Confirmar aceite" }).click();
    await expect(guest).toHaveURL(/app\/configuracoes/);
    await expect(
      guest.getByRole("heading", {
        name: "Administração restrita ao proprietário",
      }),
    ).toBeVisible();
    await expect(guest.getByLabel("Loja", { exact: true })).toHaveValue(
      (await page
        .getByLabel("Loja", { exact: true })
        .getByRole("option", { name: "Loja convidada" })
        .getAttribute("value")) ?? "",
    );
    await expect(
      guest
        .getByLabel("Loja", { exact: true })
        .getByRole("option", { name: "Loja inicial" }),
    ).toHaveCount(0);
    await guest.goto("/app/pdv");
    await expect(
      guest.getByLabel("Buscar variante por produto, SKU ou código de barras"),
    ).toBeVisible();
    await page.reload();
    const member = page.getByRole("form", {
      name: "Editar usuário Pessoa convidada",
    });
    await member.getByLabel("Vínculo ativo").uncheck();
    await member.getByRole("button", { name: "Salvar acesso" }).click();
    await expect(member.locator('input[name="revision"]')).toHaveValue("2");
    await expect(
      page
        .getByRole("form", { name: "Editar usuário Pessoa convidada" })
        .getByLabel("Vínculo ativo"),
    ).not.toBeChecked();
    await guest
      .getByLabel("Buscar variante por produto, SKU ou código de barras")
      .fill("qualquer");
    await guest
      .getByRole("button", { name: "Buscar SKU", exact: true })
      .click();
    await expect(
      guest
        .getByRole("alert")
        .filter({ hasText: "Não foi possível buscar os SKUs desta loja." }),
    ).toBeVisible();
    await guest.reload();
    await expect(guest).toHaveURL(/sem-acesso/);
  } finally {
    await context.close();
  }
});
test("lost store-create response recovers exact attempt after reload without duplicate store", async ({
  page,
}) => {
  await onboard(page, "reenvio");
  let intercepted = false;
  await page.route("**/app/configuracoes*", async (route) => {
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
  await page.getByLabel("Nome da nova loja").fill("Loja resposta perdida");
  await page
    .getByRole("button", { name: "Cadastrar loja", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Reenviar mesma tentativa" }),
  ).toBeVisible();
  const original = await page.evaluate(() =>
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith("c360:settings:"))
      .map((k) => sessionStorage.getItem(k)),
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Reenviar mesma tentativa" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage)
        .filter((k) => k.startsWith("c360:settings:"))
        .map((k) => sessionStorage.getItem(k)),
    ),
  ).toEqual(original);
  await page.getByRole("button", { name: "Reenviar mesma tentativa" }).click();
  await expect(page.getByRole("status")).toContainText("Alteração confirmada");
  await expect(
    page.getByRole("form", { name: "Editar loja Loja resposta perdida" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Reenviar mesma tentativa" }),
  ).toHaveCount(0);
  expect(intercepted).toBe(true);
});
test("legacy manager cannot administer and malformed invitation is sanitized", async ({
  page,
}) => {
  await login(page, "gerente.aurora@example.test");
  await page.goto("/app/configuracoes");
  await expect(
    page.getByRole("heading", {
      name: "Administração restrita ao proprietário",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cadastrar loja" }),
  ).toHaveCount(0);
  await page.goto("/convites");
  await page.getByLabel("Seu nome de exibição").fill("Pessoa fictícia");
  await page
    .getByLabel("Código do convite", { exact: true })
    .fill("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  await page.getByRole("button", { name: "Confirmar aceite" }).click();
  await expect(page.getByRole("status")).toContainText("convite indisponível");
  expect(page.url()).not.toContain("aaaaaaaa");
});
test("unavailable attempt storage prevents onboarding writes", async ({
  page,
}) => {
  await signup(page, "storage");
  await page.addInitScript(() => {
    Storage.prototype.setItem = function () {
      throw new Error("unavailable");
    };
    Storage.prototype.getItem = function () {
      throw new Error("unavailable");
    };
  });
  await page.goto("/onboarding");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Armazenamento da aba indisponível" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Criar empresa e primeira loja" }),
  ).toBeDisabled();
});
test("recovered uncertain attempt survives denied replay and confirms after owner access is restored", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await onboard(page, "acesso-recuperado");
  const context = await browser.newContext();
  const second = await context.newPage();
  try {
    const address = await signup(second, "segundo-owner");
    const invite = page.getByRole("form", { name: "Criar convite" });
    await invite.getByLabel("Email do convidado").fill(address);
    await invite.getByLabel("Papel", { exact: true }).selectOption("owner");
    await invite.getByLabel("Loja inicial", { exact: true }).check();
    await invite.getByRole("button", { name: "Gerar convite manual" }).click();
    const code = await page
      .getByLabel("Código do convite", { exact: true })
      .textContent();
    await second.goto("/convites");
    await second
      .getByLabel("Seu nome de exibição")
      .fill("Segundo proprietário");
    await second.getByLabel("Código do convite", { exact: true }).fill(code!);
    await second.getByRole("button", { name: "Confirmar aceite" }).click();
    await expect(second).toHaveURL(/app\/configuracoes/);
    let intercepted = false;
    await page.route("**/app/configuracoes*", async (route) => {
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
    await page.getByLabel("Nome da nova loja").fill("Loja operação incerta");
    await page
      .getByRole("button", { name: "Cadastrar loja", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Reenviar mesma tentativa" }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Reenviar mesma tentativa" }),
    ).toBeVisible();
    const original = await page.evaluate(() =>
      Object.keys(sessionStorage)
        .filter((k) => k.startsWith("c360:settings:"))
        .map((k) => sessionStorage.getItem(k)),
    );
    await second.reload();
    const target = second.getByRole("form", {
      name: "Editar usuário Proprietário acesso-recuperado",
    });
    await target.getByLabel("Papel", { exact: true }).selectOption("manager");
    await target.getByRole("button", { name: "Salvar acesso" }).click();
    await expect(target.locator('input[name="revision"]')).toHaveValue("3");
    await expect(
      second
        .getByRole("form", {
          name: "Editar usuário Proprietário acesso-recuperado",
        })
        .getByLabel("Papel", { exact: true }),
    ).toHaveValue("manager");
    await page
      .getByRole("button", { name: "Reenviar mesma tentativa" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Acesso não permitido",
    );
    await expect(
      page.getByRole("button", { name: "Reenviar mesma tentativa" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        Object.keys(sessionStorage)
          .filter((k) => k.startsWith("c360:settings:"))
          .map((k) => sessionStorage.getItem(k)),
      ),
    ).toEqual(original);
    const restore = second.getByRole("form", {
      name: "Editar usuário Proprietário acesso-recuperado",
    });
    await restore.getByLabel("Papel", { exact: true }).selectOption("owner");
    await restore.getByRole("button", { name: "Salvar acesso" }).click();
    await expect(restore.locator('input[name="revision"]')).toHaveValue("4");
    await expect(
      second
        .getByRole("form", {
          name: "Editar usuário Proprietário acesso-recuperado",
        })
        .getByLabel("Papel", { exact: true }),
    ).toHaveValue("owner");
    await page
      .getByRole("button", { name: "Reenviar mesma tentativa" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Alteração confirmada",
    );
    await expect(
      page.getByRole("form", { name: "Editar loja Loja operação incerta" }),
    ).toHaveCount(1);
  } finally {
    await context.close();
  }
});
for (const width of [360, 768, 1440]) {
  test(
    "administration fits " + width + "px with fully loaded forms",
    async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await onboard(page, "layout" + width);
      await expect(
        page.getByRole("heading", { name: "Convites recentes" }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath("configuracoes-" + width + ".png"),
        fullPage: true,
        caret: "initial",
      });
    },
  );
}
