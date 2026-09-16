import type { NextConfig } from "next";

const configuredBuildWorkers = Number.parseInt(process.env.BODEGA_BUILD_WORKERS ?? "", 10);
const buildWorkers = Number.isSafeInteger(configuredBuildWorkers) && configuredBuildWorkers > 0
  ? configuredBuildWorkers
  : undefined;

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
    // scripts/run-resource-guard.sh fija 3 en desarrollo. Sin la variable
    // (por ejemplo en CI) Next conserva su política nativa de workers.
    ...(buildWorkers ? { cpus: buildWorkers } : {}),
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
  // pdfjs-dist resuelve su propio worker (`pdf.worker.mjs`) con una ruta
  // relativa al módulo en runtime. Si el bundler lo integra al chunk del route
  // handler, ese import apunta a .next/server/chunks/pdf.worker.mjs —
  // inexistente— y `getDocument()` falla con "Setting up fake worker failed",
  // dejando la extracción de facturas siempre en `manual`. Externo conserva la
  // ruta real dentro de node_modules (ya trazado en outputFileTracingIncludes).
  // takumi-pdf está en el mismo registro que pdfjs-dist: su entry Node resuelve
  // el binario wasm (`takumi_pdf_wasm_bg.wasm`) con una ruta relativa al módulo
  // en runtime. Si el bundler lo integra al chunk del route handler, ese
  // `import.meta.url` apunta a .next/server/chunks/ y el render de la OC con
  // pdfcn falla **sólo en producción**: en `next dev` funciona.
  serverExternalPackages: ["postgres", "tesseract.js", "tesseract.js-core", "pdfjs-dist", "takumi-pdf"],
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
      // Auditorías del SGSST y el catálogo de inspecciones se fusionaron en
      // Inspecciones (2026-08-21): eran el mismo motor con los mismos permisos
      // en árboles de rutas paralelos. El tipo de instrumento pasó a filtro.
      { source: "/prevencion/auditorias", destination: "/prevencion/inspecciones?tipo=audit", permanent: true },
      { source: "/prevencion/auditorias/catalogo", destination: "/prevencion/inspecciones/plantillas", permanent: true },
      { source: "/prevencion/inspecciones/catalogo", destination: "/prevencion/inspecciones/plantillas", permanent: true },
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
      // El OCR de facturas importa el renderer PDF de forma diferida. Mantener
      // sus assets completos evita que el standalone omita pdfjs-dist.
      "./node_modules/pdfjs-dist/**/*",
      // pdfjs-dist carga este binding como dependencia opcional durante la
      // evaluación. El trazado standalone no la detecta, por lo que se debe
      // conservar el wrapper y el binario resuelto para Linux/musl.
      "./node_modules/@napi-rs/canvas/**/*",
      "./node_modules/@napi-rs/canvas-*/**/*",
      // Motor pdfcn/Takumi de la OC: el .wasm y los helpers no los alcanza el
      // trazado porque sólo se cargan tras resolver el ajuste de motor.
      "./node_modules/takumi-pdf/**/*",
      "./node_modules/@takumi-rs/**/*",
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

// `next build` corre `tsc` sobre el proyecto completo dentro del mismo proceso
// de build. En esta base (3.238 archivos) eso suma ~1 GB al pico de memoria y
// ~32 s, y el pico del build ya roza la RAM de la máquina que compila la imagen.
// El deploy corre `npm run typecheck` como paso propio y previo (scripts/
// deploy-prod.sh), así que dentro de la imagen el chequeo sería el segundo.
// Fuera de ese flujo la variable no está y `next build` sigue verificando tipos.
if (process.env.BODEGA_BUILD_SKIP_TYPECHECK === "1") {
  nextConfig.typescript = { ignoreBuildErrors: true };
}

export default nextConfig;
