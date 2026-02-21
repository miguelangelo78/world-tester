import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@world-tester/shared"],
  output: "standalone",
};

export default nextConfig;
