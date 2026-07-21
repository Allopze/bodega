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
export function createCspHeader(nonce: string, options: { isDev?: boolean } = {}): string {
  const isDev = options.isDev ?? process.env.NODE_ENV === "development"
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${
      isDev ? " 'unsafe-inline' 'unsafe-eval'" : " 'strict-dynamic'"
    }`,
    "style-src-elem 'self' 'unsafe-inline'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob: https://api.dicebear.com",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ")
}
