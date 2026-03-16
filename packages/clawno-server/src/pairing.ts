import { Router } from "express";
import crypto from "node:crypto";

interface PairToken {
  token: string;
  createdAt: number;
  consumed: boolean;
}

const TTL_MS = 120_000;
const CLEANUP_INTERVAL_MS = 60_000;
const activePairTokens = new Map<string, PairToken>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of activePairTokens) {
    if (entry.consumed || now - entry.createdAt > TTL_MS) {
      activePairTokens.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS);

export function createPairingRoutes(): Router {
  const router = Router();

  router.post("/generate", (_req, res) => {
    const token = crypto.randomBytes(20).toString("base64url");
    activePairTokens.set(token, {
      token,
      createdAt: Date.now(),
      consumed: false,
    });
    res.json({ token, expiresIn: TTL_MS / 1000 });
  });

  router.post("/verify", (req, res) => {
    const { token } = req.body as { token?: string };
    if (!token) {
      res.status(400).json({ error: "missing token" });
      return;
    }

    const entry = activePairTokens.get(token);
    if (!entry) {
      res.status(404).json({ error: "token not found" });
      return;
    }

    if (entry.consumed) {
      res.status(410).json({ error: "token already used" });
      return;
    }

    if (Date.now() - entry.createdAt > TTL_MS) {
      activePairTokens.delete(token);
      res.status(410).json({ error: "token expired" });
      return;
    }

    entry.consumed = true;
    res.json({ ok: true });
  });

  return router;
}
