import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// One .env for the whole repo lives at the root. On Vercel there is no file and the
// dashboard values are used instead.
loadEnvConfig(path.resolve(process.cwd(), ".."), process.env.NODE_ENV !== "production", undefined, true);

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_FARADAY_DOMAIN: process.env.FARADAY_DOMAIN ?? "",
    NEXT_PUBLIC_API_URL: process.env.API_URL ?? "",
  },
  // Keeps next dev from writing its own AGENTS.md into client/.
  experimental: { agentRules: false } as NextConfig["experimental"],
  // On the Vultr box every <slug>.<domain> serves its board at the root.
  async rewrites() {
    const domain = process.env.FARADAY_DOMAIN;
    if (!domain) return { beforeFiles: [] };
    const host = `(?<slug>(?!(?:www|api)\\.)[a-z0-9-]{1,63})\\.${domain.replace(/\./g, "\\.")}`;
    return { beforeFiles: [{ source: "/", has: [{ type: "host", value: host }], destination: "/b/:slug" }] };
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
