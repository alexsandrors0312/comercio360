import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill("gerente.aurora@example.test");
  await page.getByLabel("Senha", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Entrar na minha loja" }).click();
  await expect(page).toHaveURL(/\/app\/visao-geral/);
}

test("manager prepares a campaign with catalog product and exports a private PNG", async ({ page, context }, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page);
  await page.goto("/app/marketing?mes=2026-11");
  await expect(page.getByRole("heading", { name: "Calendário de marketing" })).toBeVisible();
  const title = `Novidades locais ${Date.now().toString(36)}`;
  await page.getByLabel("Título", { exact: true }).fill(title);
  await page.getByLabel("Canal planejado").selectOption("instagram");
  await page.getByLabel("Data e hora", { exact: true }).fill("2026-11-20T09:00");
  await page.getByRole("button", { name: "Criar rascunho" }).click();
  await expect(page.getByText("Operação confirmada.")).toBeVisible();
  await page.getByRole("button", { name: new RegExp(title) }).click();
  await expect(page.getByRole("heading", { name: title }).first()).toBeVisible();

  await page.getByLabel("Objetivo").selectOption("new_arrival");
  await page.getByLabel("Texto da campanha").fill("Conheça as novidades da Loja Centro. Confira preço e disponibilidade antes da divulgação.");
  await page.getByLabel("Buscar produto ou SKU").fill("CAM-AZ-P");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await page.getByRole("button", { name: "Adicionar Camiseta básica, SKU CAM-AZ-P" }).click();
  await expect(page.getByRole("region", { name: "Prévia da campanha" })).toContainText("R$ 59,90");
  await page.getByRole("button", { name: "Salvar conteúdo e produtos" }).click();
  await expect(page.getByText("Conteúdo da campanha salvo.")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: new RegExp(title) }).click();
  await expect(page.getByLabel("Objetivo")).toHaveValue("new_arrival");
  await expect(page.getByLabel("Texto da campanha")).toHaveValue("Conheça as novidades da Loja Centro. Confira preço e disponibilidade antes da divulgação.");
  await expect(page.getByRole("region", { name: "Prévia da campanha" })).toContainText("Camiseta básica");
  const cover = page.getByRole("img", { name: "Capa de Camiseta básica" });
  await expect(cover).toBeVisible();
  await expect.poll(() => cover.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(32);
  for (const width of [1440, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
    });
    const preview = page.getByRole("region", { name: "Prévia da campanha" });
    await preview.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    expect(await page.locator(".skip").evaluate(link => link.getBoundingClientRect().top)).toBeLessThan(0);
    const target = width === 360 ? preview : page.locator('aside[aria-labelledby="marketing-editor-title"]');
    await target.screenshot({ path: testInfo.outputPath(`marketing-${width === 360 ? "preview" : "editor"}-${width}.png`) });
  }
  await page.getByRole("button", { name: "Copiar texto" }).click();
  await expect(page.getByText("Texto copiado.")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar encarte PNG" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^campanha-[a-f0-9]{8}\.png$/);
  const generatedPng = sharp(await download.path());
  expect(await generatedPng.metadata()).toMatchObject({ width: 1080, height: 1350, format: "png" });
  const photoPixel = await generatedPng.extract({ left: 280, top: 600, width: 1, height: 1 }).raw().toBuffer();
  expect([...photoPixel]).not.toEqual([229, 237, 231]);
  await expect(page.getByText(/Encarte PNG gerado/)).toBeVisible();
  await expect(page.getByText(/Nenhuma mensagem é enviada/).first()).toBeVisible();

  await page.getByRole("button", { name: "Lista", exact: true }).click();
  await expect(page.getByRole("button", { name: new RegExp(title) })).toBeVisible();
  await page.getByRole("button", { name: "Próximo mês" }).click();
  await expect(page).toHaveURL(/mes=2026-12/);
});

for (const width of [360, 768, 1440]) {
  test(`marketing calendar fits ${width}px viewport`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page);
    await page.goto("/app/marketing?mes=2026-11");
    await expect(page.getByRole("heading", { name: "Calendário de marketing" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Criar rascunho" })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`marketing-${width}.png`), fullPage: true });
  });
}
