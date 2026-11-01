/**
 * Tipos y fallas compartidos por la sincronización Copec y su fuente, los web
 * services (`copec-ws.ts`). El scraper del portal que vivía acá se retiró el
 * 2026-10-31: el portal pedía un código por correo en cada login y cerraba la
 * sesión ante cualquier navegación por URL.
 */

export type CopecProduct = "diesel" | "bluemax"

/** Los dos canales se consultan con la misma llamada y sólo cambia el tipo de tarjeta:
 *  - TCT: el equipo carga con tarjeta en estación de servicio (consumo).
 *  - TAE: la vasija propia (camión/camioneta estanque) carga en estación para
 *    después repartir en faena (recepción del ciclo). */
export type CopecChannel = "TCT" | "TAE"

export interface CopecReportRequest {
  product: CopecProduct
  from: string
  to: string
}

export interface CopecDownloadedReport {
  /** La respuesta del web service tal cual. Es la evidencia que se archiva. */
  buffer: Buffer
  fileName: string
  contentType: string
  /**
   * Las filas ya traducidas a las columnas del Excel de «Descargar Detalle»
   * (`copec-ws.ts`). Con ellas se parsea sin leer `buffer`.
   */
  records: Array<Record<string, unknown> & { __row: number }>
}

export type CopecReportDownloadResult =
  | { product: CopecProduct; report: CopecDownloadedReport; unavailable: false }
  | { product: CopecProduct; unavailable: true; reason: CopecUnavailableReason }
  | { product: CopecProduct; unavailable: false; failure: { kind: CopecReportFailureKind; message: string } }

export type CopecReportFailureKind = "provider_limit" | "provider_rejected" | "network" | "invalid_file"

export class CopecReportFailure extends Error {
  constructor(readonly kind: CopecReportFailureKind, message: string) {
    super(message)
    this.name = "CopecReportFailure"
  }
}

/**
 * Copec no respondió a tiempo. Es una falla de red para el operador, pero NO se
 * reintenta: cada intento ya esperó el plazo completo de la consulta, y repetir
 * esa espera no cabe en el plazo del cron.
 */
export class CopecReportTimeoutFailure extends CopecReportFailure {
  constructor(message: string) {
    super("network", message)
    this.name = "CopecReportTimeoutFailure"
  }
}

export function isRetryableCopecFailure(error: unknown): boolean {
  return error instanceof CopecReportFailure && error.kind === "network" && !(error instanceof CopecReportTimeoutFailure)
}

/** At most one retry; auth, provider-limit and file errors fail immediately. */
export async function retryCopecRequest<T>(
  operation: () => Promise<T>,
  isRetryable: (error: unknown) => boolean = isRetryableCopecFailure,
  wait: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 750)),
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await operation()
    } catch (error) {
      if (attempt === 1 || !isRetryable(error)) throw error
      await wait()
    }
  }
  throw new Error("No fue posible completar la descarga Copec")
}

/**
 * Por qué Copec no entregó un detalle. No pesan lo mismo:
 * - `no_records`: el web service contestó «No hay registros para el filtro
 *   seleccionado.» con un acceso ya confirmado en la sesión. En un mes cerrado
 *   basta para darlo por vacío (`importCopecPeriod`).
 * - `no_results`: la misma respuesta antes de que la sesión haya leído alguna
 *   carga: podría ser la forma de Copec de decir «nada para ti», y no prueba nada.
 */
export type CopecUnavailableReason = "no_results" | "no_records"

/**
 * Si el servidor tiene con qué consultar a Copec, y si el cron tiene permiso.
 *
 * Existe para que el cron distinga "nadie configuró esto todavía" de "la
 * sincronización falló": sin credenciales la corrida lanzaba y la ruta
 * reportaba `failed`, o sea una alerta diaria por una integración que
 * simplemente no está en uso.
 *
 * `COPEC_SYNC_ENABLED` sólo apaga si vale exactamente `"false"`: el default es
 * seguir corriendo, para no apagar la integración de nadie por omisión.
 */
export function copecSyncAvailability(): { hasCredentials: boolean; syncEnabled: boolean } {
  return {
    hasCredentials: Boolean(process.env.COPEC_USERNAME?.trim() && process.env.COPEC_PASSWORD?.trim() && process.env.COPEC_CLIENT_RUT?.trim()),
    syncEnabled: process.env.COPEC_SYNC_ENABLED?.trim() !== "false",
  }
}

/** La sesión Copec de una corrida: todas sus descargas pasan por ella. */
export interface CopecSession {
  download(requests: CopecReportRequest[], channel: CopecChannel): Promise<CopecReportDownloadResult[]>
}
