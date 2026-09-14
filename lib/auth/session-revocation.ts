/**
 * AUTH-003 (auditoría 2026-09-14) — revocación de sesiones JWT.
 *
 * El restablecimiento de contraseña sólo cambiaba el hash y el token de
 * recuperación. Como las sesiones son JWT (`strategy: "jwt"`), no hay fila que
 * borrar: una cookie robada antes del cambio seguía sirviendo hasta su
 * expiración natural, aunque la víctima ya hubiera cambiado su clave. El
 * callback JWT refrescaba RBAC pero no comparaba nada temporal.
 *
 * La revocación necesita, entonces, dos datos: una marca por usuario
 * (`users.sessions_valid_from`) que la recuperación adelanta, y la fecha de
 * emisión de la sesión guardada EN el token.
 *
 * Por qué no se usa `iat`: Auth.js re-firma la cookie con `setIssuedAt()` cada
 * vez que la reemite, así que `iat` es "la última vez que se tocó la sesión", no
 * "cuándo inició sesión esta persona". Comparar contra `iat` no revocaría nada.
 * Por eso el callback graba su propia marca `sessionIssuedAt` en el sign-in y no
 * la vuelve a tocar.
 */

/** Clave del claim propio con el instante del inicio de sesión (ms epoch). */
export const SESSION_ISSUED_AT_CLAIM = "sessionIssuedAt"

/**
 * ¿Esta sesión quedó atrás de una revocación de credenciales?
 *
 * - Sin marca en el usuario (`null`): nunca se revocó nada; nadie se cae. Es lo
 *   que hace que el despliegue de esta columna no cierre ninguna sesión viva.
 * - Con marca pero sin `sessionIssuedAt` en el token: es una cookie emitida por
 *   la versión anterior del callback, de antigüedad desconocida y de un usuario
 *   que sí pidió revocar. Se cierra (falla cerrado): el único caso en que
 *   ocurre es justamente el que la revocación quiere cubrir.
 * - Con ambos datos: se cierra si la sesión es anterior a la marca. El
 *   restablecimiento se hace sin haber iniciado sesión, así que esto no expulsa
 *   a quien acaba de cambiar su clave: cuando entre después, su sesión será
 *   posterior a la marca.
 */
export function isSessionRevokedByCredentialChange(
  sessionIssuedAt: unknown,
  sessionsValidFrom: string | null | undefined,
): boolean {
  if (!sessionsValidFrom) return false

  const validFrom = new Date(sessionsValidFrom).getTime()
  if (!Number.isFinite(validFrom)) return false

  if (typeof sessionIssuedAt !== "number" || !Number.isFinite(sessionIssuedAt)) return true

  return sessionIssuedAt < validFrom
}
