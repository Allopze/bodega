/**
 * Espejo local del borrador de una inspección en curso (INS-02).
 *
 * El autoguardado contra el servidor cubre el caso normal, pero la inspección
 * se ejecuta en terreno y ahí es donde justamente no hay señal: con la pestaña
 * cerrada o el navegador descargándola en segundo plano, un checklist de 54
 * ítems (equipos móviles) o de 75 (auditoría SGSST) se perdía entero, porque
 * el borrador sólo vivía en `useState`.
 *
 * `localStorage` y no `sessionStorage` (esquema v2, 2026-10-19): el espejo está
 * para sobrevivir justo al cierre de la pestaña y del navegador, y
 * `sessionStorage` muere con ellos. Como contrapartida, lo no enviado queda en
 * el dispositivo hasta que se envía, se descarta, se declara ejecutada o
 * cancelada la inspección, o se cierra sesión (`clearAllInspectionDrafts`, que
 * llama `use-sign-out`): un equipo de faena compartido no puede heredar las
 * respuestas del usuario anterior.
 *
 * Una clave por ejecución **y por pestaña** (`…:${runId}:${tabId}`): dos
 * pestañas sobre la misma inspección no se pisan, y un guardado exitoso en una
 * no borra lo no enviado de la otra. El `tabId` vive en `sessionStorage`, que
 * es por pestaña. (Duplicar la pestaña copia el `sessionStorage`; esa pestaña
 * comparte entonces la clave de su origen, caso aceptado.)
 *
 * No es la URL: escribir la URL dispara una actualización del router de Next
 * que descarta el estado de los componentes hermanos a mitad de edición. Y no
 * IndexedDB: la cola offline ya cubre el envío del cierre, esto sólo protege el
 * trabajo a medias del propio dispositivo.
 *
 * Todo acceso va envuelto: en modo privado, con las cookies de sitio
 * bloqueadas o dentro de una captura de miniatura, el propio accessor lanza.
 * Un espejo que no se puede leer degrada a "no había borrador", nunca rompe la
 * pantalla; uno que no se puede escribir lo dice (`writeInspectionDraft`
 * devuelve `false`) para que la pantalla avise en vez de prometer lo que no
 * cumple.
 */

export interface InspectionDraftRow {
  result: string
  comment: string
  value: string
  needsConfirmation: boolean
}

export interface InspectionDraftSnapshot {
  /** Los snapshots v1 (sin esta marca) se siguen leyendo y se migran. */
  schema: 2
  /** Quién lo escribió; `null` en un snapshot migrado de v1, que no lo guardaba. */
  userId: string | null
  tabId: string
  /** Versión del run sobre la que se construyó el borrador, para no pisar trabajo ajeno. */
  version: number
  savedAt: string
  drafts: Record<string, InspectionDraftRow>
  /** Acta de cierre tecleada y aún no enviada. */
  closing?: {
    result: string
    restrictions: string
    signatures: { role: string; name: string; userId?: string | null }[]
  }
  /** Ubicación capturada y aún no enviada. */
  coords?: { lat: string; lon: string } | null
  /** Participantes tecleados y aún no guardados. */
  participants?: { id: string; name: string; position: string; userId: string | null }[]
}

/** Lo que se pasa a `writeInspectionDraft`; la marca de esquema y la pestaña las pone el módulo. */
export type InspectionDraftInput = Omit<InspectionDraftSnapshot, "schema" | "userId" | "tabId" | "savedAt"> & {
  userId?: string | null
  savedAt?: string
}

/** Un espejo encontrado en el dispositivo. */
export interface StoredInspectionDraft {
  /** Clave completa de `localStorage`; es la que acepta `clearInspectionDraft(runId, key)`. */
  key: string
  /** `true` si lo escribió esta pestaña. */
  ownTab: boolean
  /** `true` si es un espejo apartado (`…:pending:${tabId}`), que no se aplicó sobre una versión distinta. */
  pending: boolean
  snapshot: InspectionDraftSnapshot
}

const PREFIX = "chome:inspection-draft:"
const TAB_ID_KEY = "chome:inspection-tab-id"

/** Si `sessionStorage` no está disponible, un id por carga de la página sigue separando pestañas. */
let fallbackTabId: string | null = null

function newTabId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  } catch {
    // Contexto no seguro: cae al azar simple.
  }
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/** Identificador de esta pestaña, estable mientras viva (vive en `sessionStorage`). */
export function currentTabId(): string {
  try {
    const existing = sessionStorage.getItem(TAB_ID_KEY)
    if (existing) return existing
    const created = newTabId()
    sessionStorage.setItem(TAB_ID_KEY, created)
    return created
  } catch {
    fallbackTabId ??= newTabId()
    return fallbackTabId
  }
}

function runPrefix(runId: string) {
  return `${PREFIX}${runId}:`
}

/**
 * Clave de `localStorage` del espejo de esta pestaña. `pending` es el espejo
 * apartado: cuando no se pudo aplicar sobre la versión actual, se le cambia la
 * clave para que las ediciones nuevas no lo pisen mientras la persona decide.
 */
export function inspectionDraftKey(runId: string, slot: "live" | "pending" = "live"): string {
  return slot === "pending"
    ? `${runPrefix(runId)}pending:${currentTabId()}`
    : `${runPrefix(runId)}${currentTabId()}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Un espejo sin forma reconocible se descarta en vez de intentar repararlo:
 * restaurar basura sobre el checklist es peor que no restaurar nada. Acepta v2
 * y v1 (sin `schema`, `userId` ni `tabId`); un esquema posterior al 2 no se
 * interpreta.
 */
function parseSnapshot(raw: string | null, tabId: string): InspectionDraftSnapshot | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || !isRecord(parsed.drafts)) return null
    if (parsed.schema !== undefined && parsed.schema !== 2) return null
    if (typeof parsed.version !== "number") return null
    return {
      ...(parsed as unknown as InspectionDraftSnapshot),
      schema: 2,
      userId: typeof parsed.userId === "string" ? parsed.userId : null,
      tabId: typeof parsed.tabId === "string" ? parsed.tabId : tabId,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
    }
  } catch {
    return null
  }
}

function localKeys(): string[] {
  const keys: string[] = []
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (key !== null && key.startsWith(PREFIX)) keys.push(key)
  }
  return keys
}

/**
 * Trae a `localStorage` el espejo que una versión anterior dejó en
 * `sessionStorage` (`chome:inspection-draft:${runId}`, sin pestaña). Si esta
 * pestaña ya tiene uno v2, ése manda y el viejo se descarta; si la escritura
 * falla, el viejo se queda donde estaba para no perderlo.
 */
function migrateLegacyDraft(runId: string): void {
  try {
    const legacyKey = `${PREFIX}${runId}`
    const raw = sessionStorage.getItem(legacyKey)
    if (raw === null) return
    const tabId = currentTabId()
    const key = inspectionDraftKey(runId)
    const snapshot = parseSnapshot(raw, tabId)
    if (snapshot && localStorage.getItem(key) === null) {
      localStorage.setItem(key, JSON.stringify({ ...snapshot, tabId }))
    }
    sessionStorage.removeItem(legacyKey)
  } catch {
    // Cuota o almacenamiento bloqueado: se intenta de nuevo la próxima vez.
  }
}

/**
 * Todos los espejos de la ejecución en este dispositivo (todas las pestañas),
 * del más reciente al más antiguo. Migra de paso el de `sessionStorage` de la
 * versión anterior. Quien llama decide qué aplicar: ver el árbol de decisión
 * del detalle (misma versión, versión distinta, otro usuario, no editable).
 */
export function readInspectionDrafts(runId: string): StoredInspectionDraft[] {
  try {
    migrateLegacyDraft(runId)
    const ownTab = currentTabId()
    const prefix = runPrefix(runId)
    const found: StoredInspectionDraft[] = []
    for (const key of localKeys()) {
      if (!key.startsWith(prefix)) continue
      const suffix = key.slice(prefix.length)
      const pending = suffix.startsWith("pending:")
      const tabId = pending ? suffix.slice("pending:".length) : suffix
      const snapshot = parseSnapshot(localStorage.getItem(key), tabId)
      if (snapshot) found.push({ key, ownTab: tabId === ownTab, pending, snapshot })
    }
    return found.sort((a, b) => b.snapshot.savedAt.localeCompare(a.snapshot.savedAt))
  } catch {
    return []
  }
}

/**
 * El espejo más reciente de la ejecución, o `null`. Compatibilidad con quien
 * leía uno solo; el detalle nuevo usa `readInspectionDrafts`.
 */
export function readInspectionDraft(runId: string): InspectionDraftSnapshot | null {
  return readInspectionDrafts(runId)[0]?.snapshot ?? null
}

/**
 * Escribe el espejo de esta pestaña (o su variante apartada). Devuelve `false`
 * si no se pudo —cuota llena o almacenamiento bloqueado—: el autoguardado al
 * servidor sigue siendo el camino principal, pero la pantalla no puede decir
 * «se guarda en este dispositivo» cuando no es cierto.
 */
export function writeInspectionDraft(
  runId: string,
  input: InspectionDraftInput,
  slot: "live" | "pending" = "live",
): boolean {
  try {
    const snapshot: InspectionDraftSnapshot = {
      ...input,
      schema: 2,
      userId: input.userId ?? null,
      tabId: currentTabId(),
      savedAt: input.savedAt ?? new Date().toISOString(),
    }
    localStorage.setItem(inspectionDraftKey(runId, slot), JSON.stringify(snapshot))
    return true
  } catch {
    return false
  }
}

/**
 * Borra un espejo. Con `key` (la de `StoredInspectionDraft.key`) sólo ése, y
 * sólo si pertenece a la ejecución; sin ella, el de esta pestaña y el de la
 * versión anterior que haya quedado en `sessionStorage`. Nunca toca el de otra
 * pestaña por su cuenta: lo que ésta guardó no es lo que la otra tiene sin
 * enviar.
 */
export function clearInspectionDraft(runId: string, key?: string): void {
  try {
    if (key !== undefined) {
      if (key.startsWith(runPrefix(runId))) localStorage.removeItem(key)
      return
    }
    localStorage.removeItem(inspectionDraftKey(runId))
    sessionStorage.removeItem(`${PREFIX}${runId}`)
  } catch {
    // Ver arriba.
  }
}

/** Borra todos los espejos de la ejecución, de todas las pestañas (declarada ejecutada o cancelada). */
export function clearInspectionDraftsOfRun(runId: string): void {
  try {
    const prefix = runPrefix(runId)
    for (const key of localKeys()) if (key.startsWith(prefix)) localStorage.removeItem(key)
    sessionStorage.removeItem(`${PREFIX}${runId}`)
  } catch {
    // Ver arriba.
  }
}

/**
 * Borra todos los espejos de inspecciones del dispositivo (cerrar sesión). Por
 * prefijo, de modo que cualquier ejecución queda cubierta sin conocer su id, y
 * sin tocar las claves que no son de este módulo.
 */
export function clearAllInspectionDrafts(): void {
  try {
    for (const key of localKeys()) localStorage.removeItem(key)
  } catch {
    // Ver arriba.
  }
  try {
    const stale: string[] = []
    for (let index = 0; index < sessionStorage.length; index++) {
      const key = sessionStorage.key(index)
      if (key !== null && key.startsWith(PREFIX)) stale.push(key)
    }
    for (const key of stale) sessionStorage.removeItem(key)
  } catch {
    // Ver arriba.
  }
}
