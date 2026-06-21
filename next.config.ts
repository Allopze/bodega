import type { NextConfig } from "next";

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
  // doesn't trace automatically.  The key must be the URL path (route group
  // parentheses are stripped), so /(print)/sst/... becomes /sst/...
  outputFileTracingIncludes: {
    "/sst/[id]/print/pdf": ["./node_modules/playwright-core/**/*"],
  },
};

export default nextConfig;
