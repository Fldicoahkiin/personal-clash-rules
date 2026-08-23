import { refreshDueProfiles, routeSubscriptionRequest } from "./worker/subscriptions";
import type { SubscriptionEnv } from "./worker/types";

const securityHeaders = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
} as const;

function cacheControl(pathname: string): string {
  if (pathname.startsWith("/api/manage/")) {
    return "no-store";
  }
  if (pathname.startsWith("/assets/")) {
    return "public, max-age=31536000, immutable";
  }
  if (pathname.startsWith("/rules/") || pathname.startsWith("/overrides/")) {
    return "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";
  }
  if (pathname.startsWith("/s/")) {
    return "private, max-age=300, stale-while-revalidate=3600";
  }
  return "no-cache, no-transform";
}

function withResponseHeaders(response: Response, pathname: string): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders)) {
    headers.set(name, value);
  }
  headers.set(
    "Cache-Control",
    response.status >= 400 ? "no-store" : cacheControl(pathname),
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    const subscriptionResponse = await routeSubscriptionRequest(request, url, env);
    if (subscriptionResponse) {
      return withResponseHeaders(subscriptionResponse, url.pathname);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return Response.json(
        { error: "Method not allowed" },
        {
          status: 405,
          headers: {
            Allow: "GET, HEAD",
            "Cache-Control": "no-store",
            ...securityHeaders,
          },
        },
      );
    }

    if (url.pathname === "/health") {
      return Response.json(
        { status: "ok", service: "personal-clash-rules" },
        { headers: { "Cache-Control": "no-store", ...securityHeaders } },
      );
    }

    try {
      const asset = await env.ASSETS.fetch(request);
      return withResponseHeaders(asset, url.pathname);
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "asset request failed",
          path: url.pathname,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return Response.json(
        { error: "Asset request failed" },
        { status: 500, headers: securityHeaders },
      );
    }
  },
  async scheduled(_controller, env): Promise<void> {
    const result = await refreshDueProfiles(env);
    console.log(JSON.stringify({ message: "scheduled subscription refresh", ...result }));
  },
} satisfies ExportedHandler<SubscriptionEnv>;
