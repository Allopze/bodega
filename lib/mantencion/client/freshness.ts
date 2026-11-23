/**
 * ¿El HTML de la app salió del servidor hace poco o del caché del service worker? (APP-1)
 *
 * Antes se medía con el reloj del teléfono (`Date.now() - renderedAt`): un teléfono
 * adelantado, o una primera carga lenta en 3G, dejaba un HTML recién servido como
 * «viejo» y mostraba «Necesitas señal» con señal; un teléfono atrasado hacía pasar por
 * «fresco» un HTML de hace días. Ahora la edad se mide entre dos relojes DEL SERVIDOR:
 * la hora en que armó la página (`renderedAt`) y la cabecera `Date` de una consulta sin
 * caché hecha al arrancar. El reloj del teléfono no interviene.
 *
 * Sin respuesta (sin red, tiempo agotado) o con un 5xx no hay con qué comparar: el HTML
 * pudo salir del caché, así que no decide nada (`fresh = false`), como antes.
 */

/**
 * Edad máxima de un HTML «fresco». Como el reloj ya es comparable, la ventana no tiene
 * que cubrir ninguna desviación del teléfono, sólo lo que tarda en llegar el HTML, bajar
 * el JavaScript y arrancar: en una primera carga en 3G eso pasa de los dos minutos que
 * había. Diez minutos los cubre. Un HTML de caché sólo cuenta como fresco si el
 * servidor lo armó hace menos que esto y, además, el caché se reemplaza en cada carga con
 * señal, así que el caso real (el caché de otra sesión dentro de la ventana) exige un
 * cambio de cuenta seguido de una carga que agotó el tiempo del service worker.
 */
export const FRESH_WINDOW_MS = 10 * 60_000

/**
 * El HTML no puede haberse armado DESPUÉS de la hora del servidor; se tolera un minuto
 * por la resolución de segundos de `Date` y la deriva entre instancias del servidor.
 */
export const FUTURE_TOLERANCE_MS = 60_000

/**
 * Ruta de la consulta. Es de la API, así que el service worker nunca la intercepta ni la
 * guarda; es dinámica, así que ningún caché intermedio le inventa un `Date`; y responde
 * rápido a un HEAD (405 con sesión, el login sin ella: lo que importa es la cabecera).
 */
export const CLOCK_PROBE_URL = "/api/mantencion/dispositivo"

const PROBE_TIMEOUT_MS = 5_000
const PROBE_ATTEMPTS = 2

export type Reachability = "ok" | "offline" | "server-error"

export interface Freshness {
  fresh: boolean
  /** `server-error`: la plataforma contestó con un 5xx; `offline`: no contestó o no se pudo medir. */
  reachability: Reachability
}

/** Pura: con el reloj del servidor, ¿una página armada en `renderedAt` es reciente? */
export function isFreshAt(serverNowMs: number, renderedAtMs: number): boolean {
  if (!Number.isFinite(serverNowMs) || !Number.isFinite(renderedAtMs)) return false
  const age = serverNowMs - renderedAtMs
  return age >= -FUTURE_TOLERANCE_MS && age <= FRESH_WINDOW_MS
}

export interface FreshnessOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  attempts?: number
}

type Probe = { kind: "ok"; serverNowMs: number } | { kind: "server-error" } | { kind: "offline"; timedOut: boolean }

async function probeOnce(fetchImpl: typeof fetch, timeoutMs: number): Promise<Probe> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(CLOCK_PROBE_URL, { method: "HEAD", cache: "no-store", credentials: "same-origin", signal: controller.signal })
    if (response.status >= 500) return { kind: "server-error" }
    const serverNowMs = Date.parse(response.headers.get("date") ?? "")
    return Number.isFinite(serverNowMs) ? { kind: "ok", serverNowMs } : { kind: "offline", timedOut: false }
  } catch {
    return { kind: "offline", timedOut: controller.signal.aborted }
  } finally {
    clearTimeout(timer)
  }
}

export async function checkFreshness(renderedAt: string, options: FreshnessOptions = {}): Promise<Freshness> {
  const fetchImpl = options.fetchImpl ?? fetch
  const attempts = options.attempts ?? PROBE_ATTEMPTS
  // Un tropiezo rápido de una señal débil no debe mandar a «Necesitas señal»: se intenta otra vez. Un 5xx es
  // una respuesta del servidor y no se insiste; tampoco tras agotar el tiempo (wifi sin salida): otro intento
  // sólo alargaría la espera de quien abre la app sin señal.
  let last: Probe = { kind: "offline", timedOut: false }
  for (let attempt = 0; attempt < attempts; attempt++) {
    last = await probeOnce(fetchImpl, options.timeoutMs ?? PROBE_TIMEOUT_MS)
    if (last.kind !== "offline" || last.timedOut) break
  }
  if (last.kind === "ok") return { fresh: isFreshAt(last.serverNowMs, Date.parse(renderedAt)), reachability: "ok" }
  return { fresh: false, reachability: last.kind }
}
