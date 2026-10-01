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
/**
 * Origen de ingest de Sentry, derivado del DSN que el build inlineó en el
 * cliente, en vez de un wildcard *.sentry.io: `connect-src` no se abre más de
 * lo que el proyecto realmente usa (auditoría UIUX-018: sin esto el navegador
 * bloquea el envío del evento).
 */
export function sentryConnectSrcOrigin(dsn: string | undefined = process.env.NEXT_PUBLIC_SENTRY_DSN): string | null {
  if (!dsn?.trim()) return null
  try {
    return new URL(dsn.trim()).origin
  } catch {
    return null
  }
}

export function createCspHeader(nonce: string, options: { isDev?: boolean; sentryDsn?: string } = {}): string {
  const isDev = options.isDev ?? process.env.NODE_ENV === "development"
  const sentryOrigin = "sentryDsn" in options ? sentryConnectSrcOrigin(options.sentryDsn) : sentryConnectSrcOrigin()
  return [
    "default-src 'self'",
    // Next App Router inserta algunos chunks dinámicamente sin propagar el
    // nonce. `strict-dynamic` hace que Chromium ignore `'self'` y bloquea esas
    // transiciones legítimas. Se conserva el nonce para scripts inline y se
    // permite exclusivamente el mismo origen para los assets versionados.
    `script-src 'self' 'nonce-${nonce}'${
      isDev ? " 'unsafe-inline' 'unsafe-eval'" : ""
    }`,
    "style-src-elem 'self' 'unsafe-inline'",
    "style-src-attr 'unsafe-inline'",
    // Los avatares son iniciales locales desde que se retiró `api.dicebear.com`:
    // ya no hace falta habilitar un origen externo para pintar una imagen.
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // El origen de Sentry va al final para que el prefijo de la directiva no
    // dependa de si hay DSN (una aserción de test se rompió así el 2026-08-04).
    `connect-src 'self'${isDev ? " ws: wss:" : ""}${sentryOrigin ? ` ${sentryOrigin}` : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ")
}
