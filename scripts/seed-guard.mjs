// Pure preflight. No network calls, writes or secrets in diagnostics.
function projectOrigin(value) {
  if (!value)
    throw new Error(
      "Informe a URL e CONFIRM_SUPABASE_PROJECT_URL explicitamente.",
    );
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("URL do projeto inválida.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    parsed.hostname,
  );
  if (
    (parsed.protocol !== "https:" &&
      !(loopback && parsed.protocol === "http:")) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/"
  ) {
    throw new Error(
      "Use a origem HTTPS do projeto (HTTP somente em loopback), sem caminho, credenciais, query ou fragmento.",
    );
  }
  return parsed.origin;
}
export function validateSeedTarget(env) {
  if (env.ALLOW_DEVELOPMENT_SEED !== "yes")
    throw new Error("Exige ALLOW_DEVELOPMENT_SEED=yes.");
  const url = projectOrigin(env.NEXT_PUBLIC_SUPABASE_URL);
  const confirmation = projectOrigin(env.CONFIRM_SUPABASE_PROJECT_URL);
  if (url !== confirmation)
    throw new Error(
      "A confirmação do projeto não corresponde ao destino. Nenhuma operação foi executada.",
    );
  if (
    !env.SUPABASE_SECRET_KEY ||
    !env.SEED_PASSWORD ||
    env.SEED_PASSWORD.length < 12
  ) {
    throw new Error(
      "Exige chave administrativa no ambiente e SEED_PASSWORD com 12+ caracteres.",
    );
  }
  return { url, key: env.SUPABASE_SECRET_KEY, password: env.SEED_PASSWORD };
}
export function assertFictionalAccounts(specs) {
  if (
    !specs.length ||
    specs.some(
      (spec) =>
        typeof spec.email !== "string" ||
        spec.email !== spec.email.trim() ||
        !/^[a-z0-9][a-z0-9._+-]*@example\.test$/i.test(spec.email),
    )
  ) {
    throw new Error(
      "O seed aceita exclusivamente contas fictícias no domínio example.test.",
    );
  }
}
