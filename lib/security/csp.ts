/**
 * Content-Security-Policy header builder.
 *
 * Extracted from proxy.ts so it can be unit-tested independently of
 * the Next.js request/response cycle.
 *
 * Audit S-09: the policy is intentionally split so the risk surface
 * of `'unsafe-inline'` is documented per directive:
 *   - `style-src-elem` (applies to <style> blocks): unsafe-inline is
 *     a backward-compat shim. Next.js emits hashed/nonced <style>
 *     elements but the runtime also serves un-hashed ones for hot
 *     reload and for some third-party Radix components.
 *   - `style-src-attr` (applies to style="..." attributes): unsafe-inline
 *     is required for React server-rendered `style={{...}}` props.
 *     The remaining residual risk is that any future code that
 *     interpolates user input into a style prop can lead to CSS
 *     exfiltration; tracked in AUDITORIA_COMPLETA.md.
 */
// La telemetría cliente de Sentry se envía a su propio origen de ingest,
// derivado del DSN de configuración en vez de un wildcard *.sentry.io — así
// `connect-src` no se abre más de lo que el proyecto realmente usa
// (auditoría UIUX-018: sin esto, el navegador bloquea el `beforeSend` real).
function sentryConnectSrcOrigin(): string | null {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
  if (!dsn) return null
  try {
    return new URL(dsn).origin
  } catch {
    return null
  }
}

export function createCspHeader(nonce: string, options: { isDev?: boolean } = {}): string {
  const isDev = options.isDev ?? process.env.NODE_ENV === "development"
  const sentryOrigin = sentryConnectSrcOrigin()
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${
      isDev ? " 'unsafe-inline' 'unsafe-eval'" : " 'strict-dynamic'"
    }`,
    "style-src-elem 'self' 'unsafe-inline'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob: https://api.dicebear.com",
    "font-src 'self' data:",
    `connect-src 'self'${sentryOrigin ? ` ${sentryOrigin}` : ""}${isDev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ")
}
