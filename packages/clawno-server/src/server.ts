import express from "express";
import cors from "cors";
import { createProxyMiddleware } from "./proxy.js";
import { createAuthMiddleware, generateToken } from "./auth.js";
import { createProviderRoutes } from "./providers.js";
import { createPairingRoutes } from "./pairing.js";

export interface ServerConfig {
  port: number;
  host: string;
  gatewayUrl: string;
  bearerToken?: string;
}

export function createServer(config: ServerConfig) {
  const app = express();
  const token = config.bearerToken || generateToken();

  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      version: "0.1.0",
      gateway: config.gatewayUrl,
    });
  });

  const auth = createAuthMiddleware(token);

  app.use("/v1/chat/completions", auth, createProxyMiddleware(config.gatewayUrl));

  app.use("/providers", auth, createProviderRoutes(config.gatewayUrl));

  app.use("/pair", createPairingRoutes());

  return {
    start() {
      app.listen(config.port, config.host, () => {
        console.log(`\n  ClawNO11 Server v0.1.0`);
        console.log(`  ─────────────────────────────`);
        console.log(`  Listening:  http://${config.host}:${config.port}`);
        console.log(`  Gateway:    ${config.gatewayUrl}`);
        console.log(`  Auth token: ${token.slice(0, 6)}..${token.slice(-4)}`);
        console.log(`  Health:     http://${config.host}:${config.port}/health\n`);
      });
    },
    app,
    token,
  };
}
