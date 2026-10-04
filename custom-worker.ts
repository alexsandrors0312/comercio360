// @ts-expect-error OpenNext generates this module during the Cloudflare build.
import handler from "./.open-next/worker.js";

export function redirectHttpToHttps(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.protocol !== "http:") return null;

  url.protocol = "https:";
  return Response.redirect(url, 308);
}

const worker = {
  fetch(request: Request, env: unknown, ctx: unknown): Response | Promise<Response> {
    const redirect = redirectHttpToHttps(request);
    if (redirect) return redirect;
    return handler.fetch(request, env, ctx);
  },
};

export default worker;
