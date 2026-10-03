// Next can normalize Request.url to the dev server's canonical host while the
// browser still targets the Host received by the route. Compare the browser's
// Origin to that host and to the request's scheme.
export function isSameOrigin(request: Request): boolean {
  const raw = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!raw || !host) return false;
  try {
    const source = new URL(raw);
    const target = new URL(request.url);
    return (
      (source.protocol === "https:" || source.protocol === "http:") &&
      source.protocol === target.protocol &&
      source.host.toLowerCase() === host.toLowerCase() &&
      source.pathname === "/" &&
      !source.username &&
      !source.password &&
      !source.search &&
      !source.hash
    );
  } catch {
    return false;
  }
}
