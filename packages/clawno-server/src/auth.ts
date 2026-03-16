import type { RequestHandler } from "express";
import crypto from "node:crypto";

export function generateToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function createAuthMiddleware(expectedToken: string): RequestHandler {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header) {
      res.status(401).json({ error: "missing authorization header" });
      return;
    }

    const parts = header.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer" || parts[1] !== expectedToken) {
      res.status(403).json({ error: "invalid token" });
      return;
    }

    next();
  };
}
