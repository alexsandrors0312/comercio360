import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("../app/actions/settings", () => ({ settingsAction: vi.fn() }));
import { SettingsWorkspace } from "../packages/ui/settings/workspace";
import { SettingsEntry } from "../packages/ui/settings/entry";
const id = "11111111-1111-4111-8111-111111111111";
describe("Configurações009 SSR", () => {
  it("renders settings with writes disabled until recovery, role/store grant fields and no token", () => {
    const html = renderToString(
      createElement(SettingsWorkspace, {
        userId: id,
        scope: { organizationId: id, storeId: id },
        data: {
          organization: { id, name: "Empresa fictícia", revision: "1" },
          stores: [{ id, name: "Loja fictícia", active: true, revision: "1" }],
          members: [
            {
              id,
              userId: id,
              name: "Pessoa",
              role: "owner",
              active: true,
              revision: "1",
              storeIds: [id],
            },
          ],
          invitations: [],
        },
      }),
    );
    expect(html).toContain("<fieldset disabled");
    expect(html).toContain("Gerar convite manual");
    expect(html).toContain("Seu vínculo");
    expect(html).toContain("Lojas concedidas");
    expect(html).not.toContain("code_hash");
    expect(html).not.toContain("service_role");
  });
  it.each(["onboard", "accept"] as const)(
    "external %s entry is inert before hydration",
    (kind) => {
      const html = renderToString(
        createElement(SettingsEntry, { kind, userId: id }),
      );
      expect(html).toContain("<fieldset disabled");
      expect(html).toContain(
        kind === "onboard"
          ? "Criar empresa e primeira loja"
          : "Confirmar aceite",
      );
      expect(html).not.toContain('action="/app');
    },
  );
});
