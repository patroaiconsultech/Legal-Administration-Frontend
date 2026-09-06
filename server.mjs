import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import {
  collectPublicRuntimeConfig,
  runtimeEnvScript,
} from "./public-config.js";

const port = Number(process.env.PORT || 8080);
const root = path.resolve("dist");
const collectedRuntimeConfig = collectPublicRuntimeConfig(process.env);
const runtimeConfigScript = runtimeEnvScript(collectedRuntimeConfig.config);

if (collectedRuntimeConfig.errors.length) {
  console.error(
    `[ORKIO frontend] invalid public runtime config keys: ${collectedRuntimeConfig.errors
      .map((item) => `${item.key}:${item.reason || "INVALID"}`)
      .join(",")}`,
  );
}


const legalProxyConfig = (() => {
  const enabled = /^(1|true|yes)$/i.test(String(process.env.LEGAL_VERTICAL_ENABLED || ""));
  const timeoutMs = Number(process.env.LEGAL_PROXY_TIMEOUT_MS || 60000);

  function parseTarget(name, raw) {
    const value = String(raw || "").trim();
    if (!value) return { name, url: null, error: "MISSING" };

    let url;
    try {
      url = new URL(value);
    } catch {
      return { name, url: null, error: "URL_INVALID" };
    }

    if (url.username || url.password) {
      return { name, url: null, error: "URL_CREDENTIALS_FORBIDDEN" };
    }

    const localHttp =
      url.protocol === "http:" &&
      (
        url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "::1" ||
        url.hostname.endsWith(".railway.internal")
      );

    if (url.protocol !== "https:" && !localHttp) {
      return { name, url: null, error: "HTTPS_OR_RAILWAY_PRIVATE_HTTP_REQUIRED" };
    }

    url.hash = "";
    return { name, url, error: "" };
  }

  const frontend = parseTarget("LEGAL_FRONTEND_BASE_URL", process.env.LEGAL_FRONTEND_BASE_URL);
  const api = parseTarget("LEGAL_API_BASE_URL", process.env.LEGAL_API_BASE_URL);

  if (enabled) {
    for (const item of [frontend, api]) {
      if (item.error) {
        console.error(`[ORKIO frontend] ${item.name} invalid for Legal proxy: ${item.error}`);
      }
    }
  }

  return Object.freeze({
    enabled,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60000,
    frontend,
    api,
  });
})();

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const GATEWAY_SECURITY_HEADERS = new Set([
  "content-security-policy",
  "permissions-policy",
  "referrer-policy",
  "x-content-type-options",
  "x-frame-options",
]);

function incomingUrl(request) {
  try {
    return new URL(request.url || "/", "http://localhost");
  } catch {
    return null;
  }
}

function proxyTargetUrl(baseUrl, request, stripPrefix = "") {
  const incoming = incomingUrl(request);
  if (!incoming) return null;

  let pathname = incoming.pathname;
  if (stripPrefix) {
    if (pathname !== stripPrefix && !pathname.startsWith(`${stripPrefix}/`)) {
      return null;
    }
    pathname = pathname.slice(stripPrefix.length) || "/";
  }

  const target = new URL(baseUrl);
  const basePath = target.pathname === "/" ? "" : target.pathname.replace(/\/+$/, "");
  target.pathname = `${basePath}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
  target.search = incoming.search;
  target.hash = "";
  return target;
}

function forwardedHeaders(request, target) {
  const headers = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
    headers[name] = value;
  }

  headers.host = target.host;

  const originalHost = String(request.headers["x-forwarded-host"] || request.headers.host || "");
  if (originalHost) headers["x-forwarded-host"] = originalHost;

  const forwardedProto = String(request.headers["x-forwarded-proto"] || "https");
  headers["x-forwarded-proto"] = forwardedProto;

  const remoteAddress = request.socket?.remoteAddress || "";
  const prior = String(request.headers["x-forwarded-for"] || "").trim();
  if (remoteAddress) {
    headers["x-forwarded-for"] = prior ? `${prior}, ${remoteAddress}` : remoteAddress;
  }

  return headers;
}

function copyUpstreamHeaders(upstream, response) {
  for (const [name, value] of Object.entries(upstream.headers)) {
    const lower = name.toLowerCase();
    if (
      value === undefined ||
      HOP_BY_HOP_HEADERS.has(lower) ||
      GATEWAY_SECURITY_HEADERS.has(lower)
    ) {
      continue;
    }
    response.setHeader(name, value);
  }
}

function proxyUnavailable(response, kind, reason) {
  response.setHeader("Cache-Control", "no-store");
  if (kind === "api") {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.writeHead(503);
    response.end(JSON.stringify({
      error: "LEGAL_PROXY_UNAVAILABLE",
      reason,
    }));
    return;
  }

  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.writeHead(503);
  response.end("Legal Administration temporarily unavailable");
}

function proxyRequest(request, response, targetConfig, options = {}) {
  const { kind = "frontend", stripPrefix = "" } = options;

  if (!targetConfig?.url) {
    proxyUnavailable(response, kind, targetConfig?.error || "TARGET_NOT_CONFIGURED");
    return;
  }

  const target = proxyTargetUrl(targetConfig.url, request, stripPrefix);
  if (!target) {
    proxyUnavailable(response, kind, "TARGET_PATH_INVALID");
    return;
  }

  const transport = target.protocol === "https:" ? https : http;
  const upstream = transport.request(
    target,
    {
      method: request.method,
      headers: forwardedHeaders(request, target),
      timeout: legalProxyConfig.timeoutMs,
    },
    (upstreamResponse) => {
      copyUpstreamHeaders(upstreamResponse, response);
      response.setHeader("X-ORKIO-Proxy", kind === "api" ? "legal-api" : "legal-frontend");
      response.writeHead(upstreamResponse.statusCode || 502);
      upstreamResponse.pipe(response);
    },
  );

  upstream.on("timeout", () => {
    upstream.destroy(new Error("LEGAL_PROXY_TIMEOUT"));
  });

  upstream.on("error", (error) => {
    console.error(`[ORKIO frontend] Legal ${kind} proxy error: ${error.message}`);
    if (!response.headersSent) {
      proxyUnavailable(response, kind, "UPSTREAM_UNAVAILABLE");
    } else {
      response.end();
    }
  });

  request.on("aborted", () => upstream.destroy());
  request.pipe(upstream);
}

function handleLegalProxy(request, response, pathname) {
  if (!legalProxyConfig.enabled) return false;

  if (pathname === "/legal") {
    response.setHeader("Cache-Control", "no-store");
    response.writeHead(308, { Location: "/legal/" });
    response.end();
    return true;
  }

  if (pathname === "/legal-api" || pathname.startsWith("/legal-api/")) {
    proxyRequest(request, response, legalProxyConfig.api, {
      kind: "api",
      stripPrefix: "/legal-api",
    });
    return true;
  }

  if (pathname.startsWith("/legal/")) {
    proxyRequest(request, response, legalProxyConfig.frontend, {
      kind: "frontend",
    });
    return true;
  }

  return false;
}

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".woff2", "font/woff2"],
  [".xml", "application/xml; charset=utf-8"],
]);

function securityHeaders(response) {
  const connectSrc = String(process.env.ORKIO_CSP_CONNECT_SRC || "")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
  response.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      `connect-src 'self' ${connectSrc}`.trim(),
      "font-src 'self' data:",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data: blob:",
      "manifest-src 'self'",
      "media-src 'self' blob:",
      "object-src 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "worker-src 'self'",
    ].join("; "),
  );
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=(self), payment=(), usb=()",
  );
}

function cacheHeaders(response, pathname) {
  if (pathname === "/sw.js" || pathname === "/env.js") {
    response.setHeader("Cache-Control", "no-store");
    return;
  }
  if (pathname === "/manifest.webmanifest") {
    response.setHeader("Cache-Control", "no-cache");
    return;
  }
  if (pathname === "/robots.txt" || pathname === "/sitemap.xml") {
    response.setHeader("Cache-Control", "public, max-age=3600");
    return;
  }
  if (pathname.startsWith("/assets/")) {
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return;
  }
  if (pathname.startsWith("/icons/")) {
    response.setHeader("Cache-Control", "public, max-age=86400");
    return;
  }
  response.setHeader("Cache-Control", "no-cache");
}

function safePathname(rawUrl) {
  try {
    return decodeURIComponent(new URL(rawUrl || "/", "http://localhost").pathname);
  } catch {
    return null;
  }
}

function isStaticAssetRequest(pathname) {
  return (
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/icons/") ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/sw.js" ||
    Boolean(path.extname(pathname))
  );
}

function acceptsHtml(request) {
  const accept = String(request.headers.accept || "");
  return !accept || accept.includes("text/html") || accept.includes("*/*");
}

function seoHeaders(response, pathname) {
  const privateSurface =
    pathname === "/app" ||
    pathname === "/access" ||
    pathname === "/admin" ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/invite/") ||
    pathname === "/legal" ||
    pathname.startsWith("/legal/") ||
    pathname === "/legal-api" ||
    pathname.startsWith("/legal-api/");

  if (privateSurface) {
    response.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  }
}

http
  .createServer((request, response) => {
    securityHeaders(response);

    const pathname = safePathname(request.url);
    if (!pathname || pathname.includes("\0")) {
      response.writeHead(400).end("Bad request");
      return;
    }

    seoHeaders(response, pathname);

    if (handleLegalProxy(request, response, pathname)) {
      return;
    }

    if (pathname === "/env.js") {
      response.setHeader("Content-Type", "text/javascript; charset=utf-8");
      cacheHeaders(response, pathname);
      response.writeHead(200);
      response.end(runtimeConfigScript);
      return;
    }

    let requested = pathname === "/" ? "/index.html" : pathname;
    let file = path.resolve(root, `.${requested}`);
    if (!file.startsWith(`${root}${path.sep}`) && file !== root) {
      response.writeHead(400).end("Bad request");
      return;
    }

    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (isStaticAssetRequest(pathname) || !acceptsHtml(request)) {
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      file = path.join(root, "index.html");
      requested = "/index.html";
    }
    const extension = path.extname(file).toLowerCase();
    response.setHeader(
      "Content-Type",
      MIME_TYPES.get(extension) || "application/octet-stream",
    );
    if (pathname === "/sw.js") {
      response.setHeader("Service-Worker-Allowed", "/");
    }
    cacheHeaders(response, pathname);

    const stream = fs.createReadStream(file);
    stream.on("error", () => {
      if (!response.headersSent) {
        response.writeHead(500);
      }
      response.end("Internal server error");
    });
    stream.pipe(response);
  })
  .listen(port, "0.0.0.0", () => {
    console.log(`[ORKIO frontend] listening on ${port}`);
  });
