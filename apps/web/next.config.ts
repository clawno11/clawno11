import type { NextConfig } from "next";

const isGhPages = process.env.GITHUB_ACTIONS === "true" && !process.env.CUSTOM_DOMAIN;
const base = isGhPages ? "/clawno11" : "";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  basePath: base,
  assetPrefix: base ? `${base}/` : "",
  env: { NEXT_PUBLIC_BASE: base },
};

export default nextConfig;
