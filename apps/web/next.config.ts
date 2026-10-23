import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
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
  serverExternalPackages: ["jsdom", "pdf-parse", "@mozilla/readability"],
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
