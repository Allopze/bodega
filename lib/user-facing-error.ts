const MAX_USER_FACING_ERROR_LENGTH = 500

const INTERNAL_MESSAGE_PATTERNS = [
  /(?:^|\n)failed query:/i,
  /(?:^|\n)params?:/i,
  /(?:^|\n)query:\s*(?:insert|update|delete|select)\b/i,
  // M-16 (auditoría 2026-09-28): los errores del sistema de archivos
  // ("ENOENT: no such file or directory, open '/srv/app/storage/…'") le
  // mostraban al usuario la ruta del servidor.
  /\b(?:ENOENT|EACCES|EPERM|EISDIR|ENOTDIR|EMFILE|ENOSPC|EROFS)\b/,
  /(?:^|[\s'"(])\/(?:srv|app|home|var|tmp|usr|opt|etc|data|mnt)\//,
  /\b[A-Z]:\\/,
]

/**
 * Última barrera pura antes de renderizar un mensaje de error.
 * Devuelve `null` cuando el texto parece provenir de infraestructura o no cabe
 * razonablemente en feedback breve para el operador.
 */
export function userFacingErrorText(message: string): string | null {
  const concise = (message.split(/\r?\nCall log:/i)[0] ?? "").trim()
  if (!concise || concise.length > MAX_USER_FACING_ERROR_LENGTH) return null
  if (INTERNAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(concise))) return null
  return concise
}
