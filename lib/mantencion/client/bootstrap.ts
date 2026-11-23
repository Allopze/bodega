import {
  RENEW_BEFORE_MS, clearPin, credentialExpired, getAccount, getActiveAccountId, listAccounts, registerDeviceAccount, setActiveAccount,
  type RegisterResult,
} from "./accounts"
import { checkFreshness, type FreshnessOptions } from "./freshness"
import { getDeviceId, getMeta, setMeta } from "./meta"
import { requeueAuthor } from "./queue"

/**
 * Qué cuenta queda activa al abrir la app (D7/D8).
 *
 * Hay dos fuentes de verdad y no se pisan:
 *  - la SESIÓN de la plataforma (cookie): quién entró por el login;
 *  - la CUENTA ACTIVA del dispositivo: con quién se está trabajando, que en una
 *    tablet compartida cambia con el PIN, sin pasar por el login.
 *
 * Un ingreso nuevo (la sesión es de alguien distinto al último que vio la app)
 * gana: esa persona acaba de poner su contraseña. Si la sesión es la misma de
 * siempre, manda la cuenta activa: recargar la página no debe devolverle la
 * tablet al primer mecánico. El HTML que sale del caché del service worker
 * (`fresh = false`) trae la sesión de la última carga con señal y por eso nunca
 * decide nada.
 */

export interface BootstrapInput {
  sessionUser: { id: string; name: string; email: string }
  /** El HTML se renderizó hace poco: viene del servidor, no del caché sin señal. */
  fresh: boolean
  /** La plataforma contestó con un 5xx al arrancar: sin cuenta guardada se dice eso y no «sin señal». */
  serverDown?: boolean
  register?: () => Promise<RegisterResult>
  now?: number
}

export type Blocker = null | "needs-signal" | "server-down" | "no-permission" | "revoked"

export interface BootstrapResult {
  deviceId: string
  activeUserId: string | null
  blocker: Blocker
  /** La cuenta activa todavía no tiene PIN: debe definirlo antes de seguir. */
  pinSetupFor: string | null
}

/**
 * Pedir la credencial es exclusivo entre pestañas: emitir una nueva revoca la
 * anterior, y dos pestañas pidiéndola a la vez podían dejar guardada la revocada.
 */
async function registerExclusively(): Promise<RegisterResult> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks
  if (!locks?.request) return registerDeviceAccount()
  return locks.request("mant-register", () => registerDeviceAccount())
}

export async function bootstrapDevice(input: BootstrapInput): Promise<BootstrapResult> {
  const now = input.now ?? Date.now()
  const register = input.register ?? registerExclusively
  const deviceId = await getDeviceId()
  const lastSessionUserId = (await getMeta("lastSessionUserId")) ?? null
  const pinResetFor = (await getMeta("pinResetFor")) ?? null

  let sessionAccount = await getAccount(input.sessionUser.id)
  const newLogin = input.fresh && lastSessionUserId !== input.sessionUser.id
  let blocker: Blocker = null
  let serverDown = input.serverDown ?? false

  const needsCredential = input.fresh && (
    !sessionAccount
    || sessionAccount.status === "needs_login"
    || credentialExpired(sessionAccount, now)
    || Date.parse(sessionAccount.expiresAt) - now < RENEW_BEFORE_MS
  )
  if (needsCredential) {
    const result = await register()
    if (result.ok) {
      sessionAccount = result.account
      await requeueAuthor(result.account.userId)
    } else if (result.failure.kind === "auth" && result.failure.status === 403) {
      blocker = result.failure.code === "revoked" ? "revoked" : "no-permission"
    } else if (result.failure.kind === "retry" && !result.failure.network) {
      // La plataforma contestó, pero mal (5xx, o algo que no es suyo): no es falta de señal.
      serverDown = true
    }
  }
  if (input.fresh) await setMeta("lastSessionUserId", input.sessionUser.id)

  // «Olvidé mi PIN»: entró de nuevo con su contraseña, puede definir uno nuevo.
  if (pinResetFor && input.fresh && sessionAccount && pinResetFor === sessionAccount.userId) {
    await clearPin(pinResetFor)
    await setMeta("pinResetFor", null)
    sessionAccount = (await getAccount(pinResetFor)) ?? sessionAccount
  }

  const accounts = await listAccounts()
  const stored = await getActiveAccountId()
  let target = stored && accounts.some((account) => account.userId === stored) ? stored : null
  if (sessionAccount && input.fresh && (newLogin || !target)) target = sessionAccount.userId
  if (!target) target = sessionAccount?.userId ?? accounts[0]?.userId ?? null

  if (target !== stored) await setActiveAccount(target)
  if (!target && !blocker) blocker = serverDown ? "server-down" : "needs-signal"

  const active = target ? await getAccount(target) : null
  return { deviceId, activeUserId: target, blocker, pinSetupFor: active && !active.pin ? active.userId : null }
}

/** Lo que ve quien abre la app por primera vez mientras el servidor contesta con un error (APP-1). */
export const SERVER_DOWN_MESSAGE = "La plataforma no respondió bien. Intenta de nuevo en unos minutos."

export interface OpenAppInput {
  sessionUser: BootstrapInput["sessionUser"]
  /** ISO de cuando el servidor armó el HTML que cargó esta página. */
  renderedAt: string
  freshness?: FreshnessOptions
}

/**
 * Arranque de la app tal como lo usa la página: mide con el reloj del servidor si el HTML
 * es fresco (`checkFreshness`), arranca el dispositivo y, si no hay cuenta con que seguir
 * porque el servidor contestó con un 5xx, lo dice (sin señal y plataforma caída piden
 * cosas distintas al mecánico: moverse de lugar o esperar).
 */
export async function openApp(input: OpenAppInput): Promise<BootstrapResult> {
  const { fresh, reachability } = await checkFreshness(input.renderedAt, input.freshness)
  const result = await bootstrapDevice({ sessionUser: input.sessionUser, fresh, serverDown: reachability === "server-error" })
  if (result.blocker === "server-down") throw new Error(SERVER_DOWN_MESSAGE)
  return result
}
