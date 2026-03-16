import { Router } from "express";
import http from "node:http";

/**
 * Provider management routes — proxied to the OpenClaw gateway.
 *
 * GET  /providers           → list configured providers
 * POST /configure-api-key   → set provider API key
 */
export function createProviderRoutes(gatewayUrl: string): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const target = new URL("/providers", gatewayUrl);
    http
      .get(target, (proxyRes) => {
        let body = "";
        proxyRes.on("data", (c) => (body += c));
        proxyRes.on("end", () => {
          res.writeHead(proxyRes.statusCode ?? 200, { "content-type": "application/json" });
          res.end(body);
        });
      })
      .on("error", (err) => {
        res.status(502).json({ error: `gateway unreachable: ${err.message}` });
      });
  });

  router.post("/", (req, res) => {
    const target = new URL("/configure-api-key", gatewayUrl);
    const payload = JSON.stringify(req.body);

    const proxyReq = http.request(
      target,
      { method: "POST", headers: { "content-type": "application/json" } },
      (proxyRes) => {
        let body = "";
        proxyRes.on("data", (c) => (body += c));
        proxyRes.on("end", () => {
          res.writeHead(proxyRes.statusCode ?? 200, { "content-type": "application/json" });
          res.end(body);
        });
      },
    );

    proxyReq.on("error", (err) => {
      res.status(502).json({ error: `gateway unreachable: ${err.message}` });
    });

    proxyReq.write(payload);
    proxyReq.end();
  });

  return router;
}
