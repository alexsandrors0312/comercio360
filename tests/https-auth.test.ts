import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const cookieJar = vi.hoisted(() => {
  const values = new Map<string, string>();
  const written: Array<{ name: string; options: { secure?: boolean } }> = [];
  return { values, written };
});

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...cookieJar.values].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string, options: { secure?: boolean }) => {
      cookieJar.values.set(name, value);
      cookieJar.written.push({ name, options });
    },
  }),
}));

import { createClient } from "../lib/supabase/server";
import { proxy } from "../proxy";

const user = {
  id: "10000000-0000-4000-8000-000000000001",
  email: "test@example.test",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: { provider: "email" },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};

function token(exp: number) {
  return [
    { alg: "HS256", typ: "JWT" },
    { sub: user.id, exp, role: "authenticated" },
    "fixture",
  ]
    .map((part) => Buffer.from(typeof part === "string" ? part : JSON.stringify(part)).toString("base64url"))
    .join(".");
}

function authResponse(accessToken: string, expiresAt: number) {
  return {
    access_token: accessToken,
    refresh_token: "fixture-refresh",
    expires_in: Math.max(1, expiresAt - Math.floor(Date.now() / 1000)),
    expires_at: expiresAt,
    token_type: "bearer",
    user,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  cookieJar.values.clear();
  cookieJar.written.length = 0;
});

describe("HTTPS session cookies", () => {
  it("marks the real Supabase SSR login cookie Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify(authResponse(token(expiresAt), expiresAt)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));

    const client = await createClient();
    const result = await client.auth.signInWithPassword({
      email: "test@example.test",
      password: "test-password-only",
    });

    expect(result.error).toBeNull();
    expect(cookieJar.written.length).toBeGreaterThan(0);
    expect(cookieJar.written.every(({ name, options }) => name.startsWith("sb-") && options.secure === true)).toBe(true);
  });

  it("marks renewed session cookies Secure through the proxy", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
    const expiredAt = Math.floor(Date.now() / 1000) - 300;
    const renewedAt = Math.floor(Date.now() / 1000) + 3600;
    const session = authResponse(token(expiredAt), expiredAt);
    const value = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
    const request = new NextRequest("https://app.example.test/app/visao-geral", {
      headers: { Cookie: `sb-auth-auth-token=${value}` },
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/auth/v1/token"))
        return new Response(JSON.stringify(authResponse(token(renewedAt), renewedAt)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      if (url.includes("/auth/v1/user"))
        return new Response(JSON.stringify(user), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      throw new Error(`Unexpected Auth URL ${url}`);
    }));

    const response = await proxy(request);

    const refreshed = response.cookies.getAll().filter(({ name }) => name.startsWith("sb-"));
    expect(refreshed.length).toBeGreaterThan(0);
    expect(refreshed.every(({ secure }) => secure === true)).toBe(true);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
