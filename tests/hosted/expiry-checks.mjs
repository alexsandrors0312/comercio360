// Test-only policy. PostgREST permits 30 seconds of JWT clock skew.
// https://postgrest.org/en/stable/references/auth.html
export const CLOCK_SKEW_SECONDS = 30;
export const SAFETY_SECONDS = 5;

export function responseClockOffset(dateHeader, startedAt, receivedAt) {
  const serverTime = Date.parse(dateHeader ?? "");
  if (!Number.isFinite(serverTime) || receivedAt < startedAt)
    throw new Error("H1_EXPIRY_CLOCK_UNAVAILABLE");
  const offset = serverTime - (startedAt + receivedAt) / 2;
  if (Math.abs(offset) > 120000) throw new Error("H1_EXPIRY_CLOCK_DIFFERENCE");
  return offset;
}

export async function waitForExpiry(
  expiries,
  {
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    offsetMs = 0,
    onWait = () => {},
  } = {},
) {
  if (
    !expiries.length ||
    expiries.some((expiry) => !Number.isFinite(expiry) || expiry <= 0) ||
    !Number.isFinite(offsetMs)
  )
    throw new Error("H1_EXPIRY_INVALID_TIME");
  const deadline =
    (Math.max(...expiries) + CLOCK_SKEW_SECONDS + SAFETY_SECONDS) * 1000;
  if (deadline - (now() + offsetMs) > 75 * 60 * 1000)
    throw new Error("H1_EXPIRY_WAIT_LIMIT");
  while (now() + offsetMs < deadline) {
    onWait();
    await sleep(Math.min(30000, Math.max(1, deadline - (now() + offsetMs))));
  }
}

// Only fixed classifications and HTTP status leave this function.
export function expiredResponseEvidence(response) {
  const status =
    Number.isInteger(response?.status) &&
    response.status >= 100 &&
    response.status <= 599
      ? response.status
      : null;
  const expired =
    response?.body?.code === "jwt_expired" ||
    response?.body?.code === "token_expired" ||
    (typeof response?.body?.message === "string" &&
      /\b(?:jwt|token)\b.*\bexpired\b/i.test(response.body.message));
  const reason =
    status === 401
      ? expired
        ? "jwt_expired"
        : "unauthorized_other"
      : status === 200
        ? "still_accepted"
        : "unexpected_status";
  return { httpStatus: status, reason };
}
