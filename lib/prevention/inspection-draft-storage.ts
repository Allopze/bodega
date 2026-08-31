/**
 * Espejo local del borrador de una inspección en curso (INS-02).
 *
 * El autoguardado contra el servidor cubre el caso normal, pero la inspección
 * se ejecuta en terreno y ahí es donde justamente no hay señal: con la pestaña
 * cerrada o el navegador descargándola en segundo plano, un checklist de 54
 * ítems (equipos móviles) o de 75 (auditoría SGSST) se perdía entero, porque
 * el borrador sólo vivía en `useState`.
 *
 * `sessionStorage` y no la URL: escribir la URL dispara una actualización del
 * router de Next que descarta el estado de los componentes hermanos a mitad de
 * edición. Y no IndexedDB: la cola offline ya cubre el envío del cierre, esto
 * sólo protege el trabajo a medias del propio dispositivo.
 *
 * Todo acceso va envuelto: en modo privado, con las cookies de sitio
 * bloqueadas o dentro de una captura de miniatura, el propio accessor lanza.
 * Un espejo que no se puede leer degrada a "no había borrador", nunca rompe la
 * pantalla.
 */

export interface InspectionDraftSnapshot {
  /** Versión del run sobre la que se construyó el borrador, para no pisar trabajo ajeno. */
  version: number
  savedAt: string
  drafts: Record<string, { result: string; comment: string; value: string; needsConfirmation: boolean }>
}

const PREFIX = "chome:inspection-draft:"

function keyFor(runId: string) {
  return `${PREFIX}${runId}`
}

export function readInspectionDraft(runId: string): InspectionDraftSnapshot | null {
  try {
    const raw = sessionStorage.getItem(keyFor(runId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as InspectionDraftSnapshot
    // Un espejo sin forma reconocible se descarta en vez de intentar repararlo:
    // restaurar basura sobre el checklist es peor que no restaurar nada.
    if (!parsed || typeof parsed !== "object" || typeof parsed.drafts !== "object") return null
    return parsed
  } catch {
    return null
  }
}

export function writeInspectionDraft(runId: string, snapshot: InspectionDraftSnapshot): void {
  try {
    sessionStorage.setItem(keyFor(runId), JSON.stringify(snapshot))
  } catch {
    // Cuota llena o almacenamiento bloqueado. El autoguardado al servidor sigue
    // siendo el camino principal; perder el espejo no puede costar la pantalla.
  }
}

export function clearInspectionDraft(runId: string): void {
  try {
    sessionStorage.removeItem(keyFor(runId))
  } catch {
    // Ver arriba.
  }
}
