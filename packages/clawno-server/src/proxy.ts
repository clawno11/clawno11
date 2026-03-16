import type { RequestHandler } from "express";
import http from "node:http";

/**
 * Forward chat completion requests to the OpenClaw gateway.
 * Supports SSE streaming — pipes the gateway response directly to the client.
 */
export function createProxyMiddleware(gatewayUrl: string): RequestHandler {
  return (req, res) => {
    const target = new URL("/v1/chat/completions", gatewayUrl);

    const proxyReq = http.request(
      target,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: req.headers.accept || "text/event-stream",
        },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      },
    );

    proxyReq.on("error", (err) => {
      if (!res.headersSent) {
        res.status(502).json({ error: `gateway unreachable: ${err.message}` });
      }
    });

    if (req.body && Object.keys(req.body).length > 0) {
      proxyReq.write(JSON.stringify(req.body));
    } else {
      req.pipe(proxyReq, { end: true });
      return;
    }

    proxyReq.end();
  };
}
