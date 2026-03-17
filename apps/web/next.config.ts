import type { NextConfig } from "next";

const isGhPages = process.env.GITHUB_ACTIONS === "true" && !process.env.CUSTOM_DOMAIN;

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  basePath: isGhPages ? "/clawno11" : "",
  assetPrefix: isGhPages ? "/clawno11/" : "",
};

export default nextConfig;
