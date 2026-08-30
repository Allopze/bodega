const MAX_USER_FACING_ERROR_LENGTH = 500

const INTERNAL_MESSAGE_PATTERNS = [
  /(?:^|\n)failed query:/i,
  /(?:^|\n)params?:/i,
  /(?:^|\n)query:\s*(?:insert|update|delete|select)\b/i,
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
