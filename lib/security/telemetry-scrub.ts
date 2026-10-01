/**
 * Depuración de los eventos que salen hacia Sentry. Es el único `beforeSend`
 * de la plataforma: lo usan la configuración de servidor
 * (`sentry.server.config.ts`) y la de navegador (`instrumentation-client.ts`).
 *
 * HALLAZGO OBS-001 (S3/P1) — «El filtro de telemetría sólo depura dos
 * cabeceras: URL, cuerpo y usuario viajan completos». La primera integración
 * borraba `cookie` y `authorization` y dejaba pasar la URL con sus parámetros,
 * `event.request.data` —que en Next incluye la carga de una Server Action—,
 * las cookies parseadas, `event.extra` y `event.user` completo. Esta
 * plataforma mueve RUT de trabajadores, datos de salud de incidentes, casos
 * reservados y payloads clínicos.
 *
 * El criterio es lista blanca, no lista negra: se conserva lo que se sabe
 * inocuo y se descarta todo lo demás. Una lista negra hay que ampliarla cada
 * vez que aparece un campo nuevo, y ese es exactamente el fallo corregido.
 *
 * Además, el texto libre que sí viaja —mensaje de la excepción, mensaje del
 * evento y de cada miga— pasa por la misma máscara del logger
 * (`redactString`): un `Error` de la capa DTE o de una validación puede traer
 * un RUT, un correo o un secreto en su mensaje.
 *
 * Usuario: se conserva `user.id` —opaco— y se descartan correo, nombre e IP.
 * La plataforma hoy no llama a `setUser`, así que en la práctica no viaja nada.
 */
import type { init } from "@sentry/browser"
import { redactString } from "@/lib/logger"

/**
 * Qué datos junta el SDK, antes de que exista el evento. En la v11
 * `sendDefaultPii` desapareció y `dataCollection` recolecta TODO por defecto:
 * variables locales de cada frame del stack, parámetros de las queries a la
 * base, cuerpos HTTP, cookies, cabeceras y query strings. Las variables locales
 * de un frame en un servicio de PDTP o de incidentes son, literalmente, el RUT
 * y el diagnóstico. Se apaga todo lo que no sirve para depurar y se deja sólo
 * la forma de la petición; `depurarEventoTelemetria` vuelve a aplicar la misma
 * lista blanca sobre el evento armado, por si una integración la ignora.
 */
export const RECOLECCION_MINIMA = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: { allow: ["content-type", "content-length", "user-agent"] }, response: false },
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
} satisfies NonNullable<NonNullable<Parameters<typeof init>[0]>["dataCollection"]>

/** Cabeceras que se conservan: describen la forma de la petición, no su contenido. */
const CABECERAS_PERMITIDAS = new Set(["content-type", "content-length", "user-agent"])

/**
 * Contextos estándar del SDK. Cualquier contexto que no esté aquí lo puso la
 * aplicación y puede contener lo que sea, así que no viaja. `response` queda
 * fuera a propósito: arrastra cabeceras de respuesta. `nextjs` lo arma
 * `captureRequestError` con la ruta y el tipo de render; su `request_path` se
 * recorta igual que la URL.
 */
const CONTEXTOS_PERMITIDOS = new Set(["trace", "runtime", "os", "device", "app", "browser", "culture", "nextjs"])

/** Claves de una miga de pan que copian cuerpos de petición o argumentos. */
const CLAVES_DE_MIGA_CON_CARGA = ["body", "input", "arguments", "data", "response"]

/**
 * Claves de una miga que llevan una URL. Las de fetch/xhr usan `url`; las de
 * navegación del navegador, `from` y `to` — por ahí salía la query con un RUT
 * en la verificación del 2026-10-01.
 */
const CLAVES_DE_MIGA_CON_URL = ["url", "from", "to"]

interface EventoTelemetria {
  message?: unknown
  request?: {
    url?: string
    query_string?: unknown
    data?: unknown
    cookies?: unknown
    headers?: Record<string, string>
    [key: string]: unknown
  }
  user?: { id?: string | number; [key: string]: unknown }
  extra?: unknown
  contexts?: Record<string, unknown>
  exception?: {
    values?: Array<{
      value?: unknown
      stacktrace?: { frames?: Array<{ vars?: unknown; [key: string]: unknown }> }
      [key: string]: unknown
    }>
  }
  logentry?: { message?: unknown; formatted?: unknown; params?: unknown; [key: string]: unknown }
  breadcrumbs?: Array<{ message?: unknown; data?: Record<string, unknown>; [key: string]: unknown }>
  [key: string]: unknown
}

/** Deja la ruta y descarta la query y el fragmento, que llevan identificadores. */
export function despojarQueryString(url: string): string {
  const corte = url.search(/[?#]/)
  return corte === -1 ? url : url.slice(0, corte)
}

function depurarCabeceras(headers: Record<string, string>): Record<string, string> {
  const seguras: Record<string, string> = {}
  for (const [nombre, valor] of Object.entries(headers)) {
    if (CABECERAS_PERMITIDAS.has(nombre.toLowerCase())) seguras[nombre] = valor
  }
  return seguras
}

function depurarUsuario(user: NonNullable<EventoTelemetria["user"]>): EventoTelemetria["user"] {
  // Sólo el identificador opaco: correo, nombre e `ip_address` identifican a
  // una persona ante el proveedor y no hacen falta para depurar un error.
  return user.id === undefined ? {} : { id: user.id }
}

function depurarTexto(valor: unknown): unknown {
  return typeof valor === "string" ? redactString(valor) : valor
}

/**
 * Depura un evento de Sentry antes de enviarlo. Muta y devuelve el mismo
 * objeto, que es el contrato que `beforeSend` espera.
 */
export function depurarEventoTelemetria<T extends object>(evento: T): T {
  // El tipo del SDK (`ErrorEvent`) es más estrecho que lo que aquí se necesita
  // recorrer, y `beforeSend` debe devolver exactamente el mismo tipo que
  // recibe; de ahí el genérico con una vista estructural interna.
  const event = evento as EventoTelemetria

  if (event.request) {
    const { url, headers } = event.request
    // Se reconstruye la petición campo a campo: cualquier clave nueva que el
    // SDK agregue en el futuro queda fuera por omisión, no por descuido.
    event.request = {
      ...(url ? { url: despojarQueryString(url) } : {}),
      ...(headers ? { headers: depurarCabeceras(headers) } : {}),
      ...(typeof event.request.method === "string" ? { method: event.request.method } : {}),
    }
  }

  if (event.user) event.user = depurarUsuario(event.user)

  // `extra` es el saco donde `captureException(error, contexto)` deja lo que
  // quiera quien llama; no hay forma de saber si trae un RUT.
  delete event.extra

  if (event.contexts) {
    for (const clave of Object.keys(event.contexts)) {
      if (!CONTEXTOS_PERMITIDOS.has(clave)) delete event.contexts[clave]
    }
    const nextjs = event.contexts.nextjs as { request_path?: unknown } | undefined
    if (nextjs && typeof nextjs.request_path === "string") {
      nextjs.request_path = despojarQueryString(nextjs.request_path)
    }
  }

  if ("message" in event) event.message = depurarTexto(event.message)
  if (event.logentry) {
    event.logentry.message = depurarTexto(event.logentry.message)
    event.logentry.formatted = depurarTexto(event.logentry.formatted)
    delete event.logentry.params
  }
  for (const excepcion of event.exception?.values ?? []) {
    excepcion.value = depurarTexto(excepcion.value)
    // Variables locales del frame: `RECOLECCION_MINIMA` ya no las pide; si una
    // integración las agrega igual, no viajan.
    for (const frame of excepcion.stacktrace?.frames ?? []) delete frame.vars
  }

  if (Array.isArray(event.breadcrumbs)) {
    for (const miga of event.breadcrumbs) {
      if ("message" in miga) miga.message = depurarTexto(miga.message)
      if (!miga.data) continue
      for (const clave of CLAVES_DE_MIGA_CON_CARGA) delete miga.data[clave]
      for (const clave of CLAVES_DE_MIGA_CON_URL) {
        if (typeof miga.data[clave] === "string") miga.data[clave] = despojarQueryString(miga.data[clave])
      }
    }
  }

  return evento
}
