// Exit codes only: never expose provider messages, payloads, input values or URLs.
export function seedPreflightExitCode(env) {
  if (env.ALLOW_DEVELOPMENT_SEED !== "yes") return 20;
  if (!env.NEXT_PUBLIC_SUPABASE_URL?.trim()) return 21;
  if (!env.CONFIRM_SUPABASE_PROJECT_URL?.trim()) return 22;
  if (!env.SUPABASE_SECRET_KEY?.trim()) return 24;
  if (!env.SEED_PASSWORD || env.SEED_PASSWORD.length < 12) return 25;
  return 23; // Invalid origin, disagreement or another preflight rejection.
}

export function seedFailureExitCode(stage, error) {
  let category = 9;
  if (
    [401, 403].includes(error?.status) ||
    ["bad_jwt", "not_admin", "42501"].includes(error?.code)
  )
    category = 1;
  else if (
    error?.name === "AuthRetryableFetchError" ||
    error instanceof TypeError
  )
    category = 2;
  else if (["PGRST205", "42P01"].includes(error?.code)) category = 3;
  else if (error?.code === "23503") category = 4;
  else if (error?.code === "23514") category = 5;
  else if (error?.code === "weak_password") category = 6;
  else if (error?.code === "H1_MISSING_SEED") category = 7;
  return stage * 10 + category;
}
