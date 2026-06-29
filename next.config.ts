import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["bodega.allopze.dev", "bodega.chome.dev"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  // playwright-core ships non-JS assets (browsers.json, etc.) that NFT
  // doesn't trace automatically. Both print/PDF routes import Playwright
  // lazily through lib/pdf/browser-pool.ts, so keep the package assets in the
  // standalone trace explicitly.
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/playwright-core/browsers.json",
      "./node_modules/playwright-core/lib/**/*",
      "./node_modules/playwright-core/index.*",
      "./node_modules/playwright-core/package.json",
      "./node_modules/playwright/**/*",
    ],
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
});
