/**
 * HALLAZGO OBS-001 (S3/P1) — «El filtro de telemetría sólo depura dos
 * cabeceras: URL, cuerpo y usuario viajan completos».
 *
 * Los tres `beforeSend` de Sentry (servidor, edge y navegador) borraban
 * `cookie` y `authorization` y devolvían el resto intacto: la URL con sus
 * parámetros de consulta, `event.request.data` —que en Next incluye la carga
 * de una Server Action—, las cookies parseadas, `event.extra` y `event.user`
 * completo. Esta plataforma mueve RUT de trabajadores, datos de salud de
 * incidentes, casos reservados y payloads clínicos: un error no controlado
 * dentro de una acción que reciba esos datos los mandaba al proveedor de
 * telemetría junto con la traza.
 *
 * El criterio aquí es lista blanca, no lista negra: se conserva lo que se sabe
 * inocuo y se descarta todo lo demás. Una lista negra hay que ampliarla cada
 * vez que aparece un campo nuevo, y ese es exactamente el fallo que se está
 * corrigiendo.
 *
 * DECISIÓN PENDIENTE (no se inventa aquí): la plataforma no declara en ninguna
 * parte si el identificador de usuario puede salir hacia el proveedor de
 * telemetría. Se conserva `user.id` —opaco, ya lo enviaba `sentry.setUser`— y
 * se descartan correo, nombre e IP. Si la decisión fuera "ningún dato de
 * usuario", basta con vaciar `event.user` en `depurarUsuario`.
 */

/** Cabeceras que se conservan: describen la forma de la petición, no su contenido. */
const CABECERAS_PERMITIDAS = new Set(["content-type", "content-length", "user-agent"])

/**
 * Contextos estándar del SDK. Cualquier contexto que no esté aquí lo puso la
 * aplicación y puede contener lo que sea, así que no viaja. `response` queda
 * fuera a propósito: arrastra cabeceras de respuesta.
 */
const CONTEXTOS_PERMITIDOS = new Set(["trace", "runtime", "os", "device", "app", "browser", "culture"])

/** Claves de una miga de pan que copian cuerpos de petición o argumentos. */
const CLAVES_DE_MIGA_CON_CARGA = ["body", "input", "arguments", "data", "response"]

interface EventoTelemetria {
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
  breadcrumbs?: Array<{ data?: Record<string, unknown>; [key: string]: unknown }>
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

  // `extra` es el saco donde `sentry.captureException(error, contexto)` deja
  // lo que quiera quien llama; no hay forma de saber si trae un RUT.
  delete event.extra

  if (event.contexts) {
    for (const clave of Object.keys(event.contexts)) {
      if (!CONTEXTOS_PERMITIDOS.has(clave)) delete event.contexts[clave]
    }
  }

  if (Array.isArray(event.breadcrumbs)) {
    for (const miga of event.breadcrumbs) {
      if (!miga.data) continue
      for (const clave of CLAVES_DE_MIGA_CON_CARGA) delete miga.data[clave]
      if (typeof miga.data.url === "string") miga.data.url = despojarQueryString(miga.data.url)
    }
  }

  return evento
}
