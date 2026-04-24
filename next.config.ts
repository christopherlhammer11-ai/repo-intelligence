import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@lancedb/lancedb"],
};

export default nextConfig;
