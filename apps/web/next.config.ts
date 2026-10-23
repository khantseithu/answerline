import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  serverExternalPackages: ["jsdom", "pdf-parse", "@mozilla/readability"],
  async redirects() {
    return [
      {
        destination: "/overview",
        permanent: false,
        source: "/dashboard",
      },
      {
        destination: "/",
        permanent: false,
        source: "/landing",
      },
    ];
  },
  transpilePackages: ["@answerline/shared", "@answerline/db", "@answerline/worker"],
  turbopack: {
    rules: {
      "*.css": {
        as: "*.css",
        loaders: ["@tailwindcss/turbopack"],
      },
    },
  },
};

export default nextConfig;
