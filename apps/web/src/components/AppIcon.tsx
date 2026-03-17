"use client";

import { useEffect, useRef } from "react";

export function AppIcon({ size = 144 }: { size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const img = new Image();
    img.onload = () => {
      const W = img.naturalWidth;
      const H = img.naturalHeight;
      canvas.width = W;
      canvas.height = H;

      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, W, H);
      const d = imageData.data;

      const idx = (x: number, y: number) => (y * W + x) * 4;

      // ── Step 1: Flood-fill from 4 corners ──────────────────────────────
      // Sample background color from corner
      const bgR = d[idx(0, 0)], bgG = d[idx(0, 0) + 1], bgB = d[idx(0, 0) + 2];
      const TOLERANCE = 80; // higher = catches more background gradient

      const colorDist = (i: number) => {
        const dr = d[i] - bgR, dg = d[i + 1] - bgG, db = d[i + 2] - bgB;
        return Math.sqrt(dr * dr + dg * dg + db * db);
      };

      const visited = new Uint8Array(W * H);
      const stack: number[] = [];

      const seed = (x: number, y: number) => {
        if (x >= 0 && x < W && y >= 0 && y < H) stack.push(x, y);
      };
      // Seed from all 4 corners + extra seeds along edges every 20px
      for (let x = 0; x < W; x += 20) { seed(x, 0); seed(x, H - 1); }
      for (let y = 0; y < H; y += 20) { seed(0, y); seed(W - 1, y); }

      while (stack.length) {
        const y = stack.pop()!;
        const x = stack.pop()!;
        if (x < 0 || x >= W || y < 0 || y >= H) continue;
        const vi = y * W + x;
        if (visited[vi]) continue;
        const pi = vi * 4;
        if (colorDist(pi) > TOLERANCE) continue;

        visited[vi] = 1;
        d[pi + 3] = 0; // fully transparent

        // 8-connected for cleaner edges
        stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
        stack.push(x + 1, y + 1, x - 1, y - 1, x + 1, y - 1, x - 1, y + 1);
      }

      // ── Step 2: Feather dark fringe pixels left behind ──────────────────
      // Any surviving pixel that is still very dark & blue-dominant
      // is anti-aliasing remnant from the bg → fade it out proportionally
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const bright = Math.max(r, g, b);
        // Dark + blue-dominant = leftover background fringe
        if (bright < 100 && b >= r && b >= g) {
          // Smoothly fade: fully transparent at bright=0, original alpha at bright=100
          d[i + 3] = Math.round(d[i + 3] * (bright / 100));
        }
      }

      ctx.putImageData(imageData, 0, 0);
    };
    img.src = "/icon.png";
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: size,
        height: size,
        filter:
          "drop-shadow(0 0 30px rgba(6,182,212,0.55)) drop-shadow(0 0 12px rgba(6,182,212,0.35))",
      }}
    />
  );
}
