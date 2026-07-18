import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// NOTE: la Content-Security-Policy se define en el middleware (`proxy.ts` →
// `lib/security/csp.ts`) con nonce por request + 'strict-dynamic'. No se
// duplica aquí para evitar dos cabeceras CSP en conflicto.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    serverActions: {
      // The largest Server Action upload is 20 MB. Leave multipart overhead
      // headroom while keeping the framework cap below the configured storage
      // maximum, so domain validation is always reached for accepted files.
      bodySizeLimit: "21mb",
    },
  },
  // Tesseract calcula por defecto el worker Node desde su propio __dirname.
  // Si Turbopack lo integra al bundle, ese dirname queda congelado como
  // /ROOT/node_modules y el standalone no puede iniciar OCR. Mantener ambos
  // paquetes externos conserva sus rutas reales en runtime.
  serverExternalPackages: ["postgres", "tesseract.js", "tesseract.js-core"],
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [360, 480, 640, 750, 828, 1080, 1200, 1920],
  },
  allowedDevOrigins: ["bodega.allopze.dev", "bodega.chome.dev"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  // Repuestos/servicios were folded into the unified Solicitudes flow. Detail
  // links map 1:1 (same purchase_requests row); list/create land on Solicitudes.
  async redirects() {
    return [
      { source: "/repuestos/nueva", destination: "/solicitudes/nueva?tipo=repuestos", permanent: false },
      { source: "/servicios/nueva", destination: "/solicitudes/nueva?tipo=servicios", permanent: false },
      { source: "/repuestos/:id", destination: "/solicitudes/:id", permanent: false },
      { source: "/servicios/:id", destination: "/solicitudes/:id", permanent: false },
      { source: "/repuestos", destination: "/solicitudes", permanent: false },
      { source: "/servicios", destination: "/solicitudes", permanent: false },
      // Biblioteca SST renamed to Documentación (2026-07-02)
      { source: "/prevencion/biblioteca", destination: "/prevencion/documentacion", permanent: true },
      { source: "/prevencion/biblioteca/:path*", destination: "/prevencion/documentacion/:path*", permanent: true },
      // Subrutas de la biblioteca retiradas; se conserva la compatibilidad
      // de bookmarks como redirect de borde en vez de renderizar stubs.
      { source: "/prevencion/documentacion/nuevo", destination: "/prevencion/documentacion", permanent: true },
      { source: "/prevencion/documentacion/revisiones", destination: "/prevencion/documentacion", permanent: true },
      { source: "/prevencion/documentacion/vencimientos", destination: "/prevencion/documentacion", permanent: true },
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
      "./node_modules/tesseract.js/**/*",
      "./node_modules/tesseract.js-core/**/*",
    ],
  },
  outputFileTracingExcludes: {
    "/*": [
      "./Registros SG-SST/**/*",
      "./audit/screenshots/**/*",
      "./coverage/**/*",
    ],
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
});
