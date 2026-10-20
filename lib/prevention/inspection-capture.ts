/**
 * Contratos de la captura en terreno de una inspección (cliente y servidor).
 *
 * Módulo puro y sin dependencias de React ni de la base: lo importan el hook de
 * autoguardado, el detalle de la ejecución y la acción del servidor. Los tipos
 * y el lector del código de error son de la Fase 0; abajo viven las funciones
 * que arman lo que se envía (normalizar, retener filas, comparar, rebasar un
 * borrador) y los textos del estado de guardado.
 */
import {
  requiresHumanConfirmation,
  validateAnswerRow,
  type CompletionBlocker,
  type InspectionAnswerInput,
  type InspectionItemSpec,
  type InspectionResult,
} from "@/lib/prevention/inspections"

/**
 * Códigos que el servidor adjunta a un rechazo permanente (`data.code`). Sin
 * ellos el cliente solo ve un texto y no puede distinguir un conflicto de
 * versión —que se arregla recuperando— de un error que reintentar no corrige.
 */
export type InspectionErrorCode =
  | "version_conflict"
  | "not_editable"
  | "evidence_guard"
  | "invalid_row"
  | "not_ready"

const ERROR_CODES: readonly InspectionErrorCode[] = [
  "version_conflict",
  "not_editable",
  "evidence_guard",
  "invalid_row",
  "not_ready",
]

/** Lee `data.code` de un resultado de acción; `null` si no trae uno conocido. */
export function saveErrorCodeOf(result: { ok: boolean; data?: Record<string, unknown> } | null | undefined): InspectionErrorCode | null {
  if (!result || result.ok) return null
  const code = result.data?.code
  return typeof code === "string" && (ERROR_CODES as readonly string[]).includes(code)
    ? (code as InspectionErrorCode)
    : null
}

/** Estado de guardado que la pantalla muestra, una sola fuente para escritorio y móvil. */
export type CaptureSaveState =
  | { kind: "saved"; heldCount: number }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "offline" }
  | { kind: "retrying" }
  | { kind: "conflict" }
  | { kind: "not_editable" }
  | { kind: "rejected"; message: string }
  | { kind: "closing" }
  | { kind: "queued_close" }

/**
 * Fila que se queda en el dispositivo sin enviarse: o es inválida (falta un
 * motivo) o se limpió a «Sin responder» teniendo fotos, que el servidor no
 * permite dejar sin respuesta.
 */
export interface HeldRow {
  key: string
  reason: "invalid" | "unanswer_with_photos"
  problem: string
}

/* ── Funciones puras de la captura ────────────────────────────────────────── */

/**
 * Lo que la persona ve y edita en una fila del checklist. Misma forma que el
 * `Draft` de la pantalla (su `ResultValue` es un subconjunto de `string`), así
 * que el estado del detalle se pasa tal cual.
 */
export interface CaptureDraft {
  /** `""` es «Sin responder». */
  result: string
  comment: string
  value: string
  needsConfirmation: boolean
}

/** Mismo tope que `answerRowSchema` del servidor para `value` y `comment`. */
export const MAX_ANSWER_TEXT_LENGTH = 2000

const EMPTY_DRAFT: CaptureDraft = { result: "", comment: "", value: "", needsConfirmation: false }

/** Clave de una fila en los mapas de borradores y de lo persistido. */
export function captureKey(sectionId: string, itemId: string): string {
  return `${sectionId}::${itemId}`
}

function trimmedOrNull(text: string | null | undefined): string | null {
  const trimmed = text?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Convierte el borrador de una fila en la respuesta que viaja al servidor, o
 * `null` si está en «Sin responder».
 *
 * Replica la normalización del servidor (`answerRowSchema` y la inserción de
 * `saveAnswersWithClient`): recorta, un texto vacío es `null` y la marca de
 * ratificación sólo sobrevive en los ítems que exigen confirmación humana.
 * Importa que sea idéntica: si el cliente comparara «tal cual lo tecleado»
 * contra «tal cual lo devolvió el servidor», un espacio al final dejaría la
 * pantalla sucia para siempre.
 */
export function normalizeAnswer(item: InspectionItemSpec, draft: CaptureDraft): InspectionAnswerInput | null {
  if (draft.result === "") return null
  return {
    sectionId: item.sectionId,
    itemId: item.itemId,
    result: draft.result as InspectionResult,
    comment: trimmedOrNull(draft.comment),
    value: trimmedOrNull(draft.value),
    needsConfirmation: draft.needsConfirmation && requiresHumanConfirmation(item),
  }
}

/** La respuesta persistida como borrador, para compararla o rebasarla con `diffDrafts`/`rebaseDrafts`. */
export function draftFromAnswer(answer: Pick<InspectionAnswerInput, "result" | "comment" | "value" | "needsConfirmation">): CaptureDraft {
  return {
    result: answer.result,
    comment: answer.comment ?? "",
    value: answer.value ?? "",
    needsConfirmation: answer.needsConfirmation ?? false,
  }
}

/** `draftFromAnswer` sobre un mapa completo (lo que trajo el servidor al montar). */
export function draftsFromAnswers(answers: Pick<InspectionAnswerInput, "sectionId" | "itemId" | "result" | "comment" | "value" | "needsConfirmation">[]): Record<string, CaptureDraft> {
  const drafts: Record<string, CaptureDraft> = {}
  for (const answer of answers) drafts[captureKey(answer.sectionId, answer.itemId)] = draftFromAnswer(answer)
  return drafts
}

/**
 * Arma lo que se envía al guardar: **todas las filas válidas y, de cada fila
 * retenida, su última versión persistida**.
 *
 * El servidor tiene semántica de conjunto completo —una fila ausente del envío
 * se borra— y valida el lote entero, de modo que una sola fila mala frenaba el
 * guardado de las demás (P1-1). Aquí una fila queda *retenida* (`held`) si
 * `validateAnswerRow` la rechaza, o si se limpió a «Sin responder» teniendo
 * fotos persistidas, que el servidor no deja huérfanas. La retenida no viaja
 * con lo que tiene la pantalla sino con lo último que el servidor ya tiene de
 * ella (si nunca se persistió, se omite): así no se pierde la fila anterior ni
 * su evidencia, y el resto sí se guarda.
 *
 * - `persisted`: lo que el servidor tiene por clave, ya normalizado (lo que
 *   trajo al montar y, después de cada guardado, el envío realmente hecho).
 * - `photoCountByKey`: fotos persistidas por clave; ausente = 0.
 *
 * Las filas retenidas NO cuentan como trabajo sin guardar (no entran en
 * `isDirty`): recrearían el bucle de reintentos contra una fila que el
 * servidor va a rechazar siempre. Se muestran aparte, con `summarizeCompletion`.
 */
export function buildAnswersPayload(args: {
  items: InspectionItemSpec[]
  drafts: Readonly<Record<string, CaptureDraft>>
  persisted: Readonly<Record<string, InspectionAnswerInput>>
  photoCountByKey?: Readonly<Record<string, number>>
}): { answers: InspectionAnswerInput[]; held: HeldRow[] } {
  const answers: InspectionAnswerInput[] = []
  const held: HeldRow[] = []

  for (const item of args.items) {
    const key = captureKey(item.sectionId, item.itemId)
    const draft = args.drafts[key]
    const previous = args.persisted[key]
    const keepPrevious = () => { if (previous) answers.push(previous) }

    const answer = draft ? normalizeAnswer(item, draft) : null
    if (!answer) {
      // «Sin responder»: se borra la fila, salvo que la evidencia lo impida.
      if (previous && (args.photoCountByKey?.[key] ?? 0) > 0) {
        held.push({
          key,
          reason: "unanswer_with_photos",
          problem: `Para dejar «${item.label}» sin responder, quita primero sus fotos.`,
        })
        keepPrevious()
      }
      continue
    }

    const problem = (answer.comment?.length ?? 0) > MAX_ANSWER_TEXT_LENGTH || (answer.value?.length ?? 0) > MAX_ANSWER_TEXT_LENGTH
      ? `«${item.label}»: el texto supera los ${MAX_ANSWER_TEXT_LENGTH} caracteres.`
      : validateAnswerRow(item, answer)
    if (problem) {
      held.push({ key, reason: "invalid", problem })
      keepPrevious()
      continue
    }
    answers.push(answer)
  }
  return { answers, held }
}

function sameAnswer(a: InspectionAnswerInput, b: InspectionAnswerInput): boolean {
  return a.result === b.result
    && (a.comment ?? null) === (b.comment ?? null)
    && (a.value ?? null) === (b.value ?? null)
    && (a.needsConfirmation ?? false) === (b.needsConfirmation ?? false)
}

/**
 * ¿Son el mismo conjunto de respuestas? Sin importar el orden. Es el `isDirty`
 * derivado: «lo que se enviaría» frente a «lo que el servidor tiene».
 */
export function sameAnswerSet(a: readonly InspectionAnswerInput[], b: readonly InspectionAnswerInput[]): boolean {
  if (a.length !== b.length) return false
  const byKey = new Map(b.map((answer) => [captureKey(answer.sectionId, answer.itemId), answer]))
  return a.every((answer) => {
    const other = byKey.get(captureKey(answer.sectionId, answer.itemId))
    return other !== undefined && sameAnswer(answer, other)
  })
}

function normalizedDraft(draft: CaptureDraft | undefined): CaptureDraft {
  if (!draft) return EMPTY_DRAFT
  return {
    result: draft.result,
    comment: draft.comment.trim(),
    value: draft.value.trim(),
    needsConfirmation: draft.needsConfirmation,
  }
}

function sameDraft(a: CaptureDraft | undefined, b: CaptureDraft | undefined): boolean {
  const left = normalizedDraft(a)
  const right = normalizedDraft(b)
  return left.result === right.result
    && left.comment === right.comment
    && left.value === right.value
    && left.needsConfirmation === right.needsConfirmation
}

/**
 * Claves cuyo borrador difiere entre dos mapas. Una fila ausente equivale a
 * «Sin responder» vacía, y se compara recortado, igual que el envío.
 *
 * Responde «¿qué perdería la persona?» (a diferencia de `buildAnswersPayload`,
 * una fila sin resultado pero con un comentario ya tecleado sí cuenta): decide
 * si hay algo que rescatar de un espejo del dispositivo y cuántas respuestas
 * difieren del servidor.
 */
export function diffDrafts(
  local: Readonly<Record<string, CaptureDraft>>,
  base: Readonly<Record<string, CaptureDraft>>,
): string[] {
  const keys = new Set([...Object.keys(local), ...Object.keys(base)])
  return [...keys].filter((key) => !sameDraft(local[key], base[key]))
}

/**
 * Aplica los cambios locales sobre una versión más nueva del servidor.
 *
 * Parte de `server` y encima pone lo que la persona cambió: una fila local
 * gana sólo si difiere de `oldPersisted` (lo que el servidor tenía cuando ella
 * empezó a editar). Lo que ella no tocó se queda con lo del servidor —el
 * trabajo del otro inspector— en vez de pisarlo con una copia vieja. Una fila
 * que la persona dejó en «Sin responder» se quita del resultado.
 */
export function rebaseDrafts(args: {
  server: Readonly<Record<string, CaptureDraft>>
  oldPersisted: Readonly<Record<string, CaptureDraft>>
  local: Readonly<Record<string, CaptureDraft>>
}): Record<string, CaptureDraft> {
  const rebased: Record<string, CaptureDraft> = { ...args.server }
  const keys = new Set([...Object.keys(args.local), ...Object.keys(args.oldPersisted)])
  for (const key of keys) {
    if (sameDraft(args.local[key], args.oldPersisted[key])) continue
    const mine = args.local[key]
    if (!mine || (mine.result === "" && !mine.comment.trim() && !mine.value.trim())) delete rebased[key]
    else rebased[key] = mine
  }
  return rebased
}

/** Estados que la pantalla distingue ante un guardado fallido. */
export type SaveFailureState = Extract<
  CaptureSaveState,
  { kind: "offline" | "retrying" | "conflict" | "not_editable" | "rejected" }
>

export interface SaveFailureInfo {
  /** `true` si reintentar tal cual puede funcionar (red, servidor sin responder). */
  transient: boolean
  code: InspectionErrorCode | null
  state: SaveFailureState
}

/**
 * Clasifica un guardado fallido para el hook de autoguardado (`isTransient`) y
 * para el estado que muestra la pantalla.
 *
 * - Una excepción (`result` nulo, o `thrown`) es la red que no respondió:
 *   transitoria. Con `online === false` el estado es `offline`; si no,
 *   `retrying`.
 * - `version_conflict` y `not_editable` son permanentes y tienen su propio
 *   estado: el primero se arregla recuperando, el segundo ya no tiene arreglo.
 * - Cualquier otro rechazo del servidor —con código (`evidence_guard`,
 *   `invalid_row`, `not_ready`) o sin él— es permanente: reintentar el mismo
 *   envío da el mismo rechazo, y un bucle cada 30 s contra una guarda no arregla
 *   nada. Se muestra con su mensaje y «Reintentar»; la próxima edición también
 *   vuelve a intentarlo.
 */
export function classifySaveFailure(
  result: { ok: boolean; message?: string; data?: Record<string, unknown> } | null | undefined,
  options: { thrown?: boolean; online?: boolean } = {},
): SaveFailureInfo {
  if (options.thrown || !result) {
    return {
      transient: true,
      code: null,
      state: options.online === false ? { kind: "offline" } : { kind: "retrying" },
    }
  }
  const code = saveErrorCodeOf(result)
  if (code === "version_conflict") return { transient: false, code, state: { kind: "conflict" } }
  if (code === "not_editable") return { transient: false, code, state: { kind: "not_editable" } }
  return {
    transient: false,
    code,
    state: { kind: "rejected", message: result.message ?? "No se pudo guardar." },
  }
}

/**
 * Texto corto del estado de guardado. Una sola fuente para la cabecera de
 * escritorio y la barra móvil (P1-7): que las dos digan lo mismo.
 */
export function captureStatusLabel(state: CaptureSaveState): string {
  switch (state.kind) {
    case "saving": return "Guardando…"
    case "dirty": return "Cambios sin guardar"
    case "saved":
      if (state.heldCount <= 0) return "Guardado"
      return state.heldCount === 1
        ? "Guardado, salvo 1 respuesta incompleta"
        : `Guardado, salvo ${state.heldCount} respuestas incompletas`
    case "offline": return "Sin conexión · se enviará al volver la señal"
    case "retrying": return "No se pudo guardar · reintentando"
    case "conflict": return "Cambió en otra sesión"
    case "not_editable": return "Ya no se puede editar"
    case "rejected": return "No se pudo guardar"
    case "closing": return "Declarando ejecutada…"
    case "queued_close": return "Cierre pendiente de enviar"
  }
}

export interface CompletionSummaryLine {
  /** Clave del ítem al que saltar, o `null` si no cuelga de uno (el acta). */
  key: string | null
  text: string
  /** `true` si es una fila retenida (no se está guardando) y no un impedimento de cierre. */
  held: boolean
}

export interface CompletionSummary {
  lines: CompletionSummaryLine[]
  /** Primer ítem al que se puede saltar («Ir al primero»), o `null`. */
  firstKey: string | null
  heldCount: number
  /** `false` si hay filas retenidas o impedimentos: el cierre debe bloquearse. */
  canComplete: boolean
}

/**
 * Resume lo que impide declarar ejecutada, para el diálogo de cierre: las filas
 * retenidas primero (lo que hoy no se guarda) y luego los impedimentos del
 * gate. Una fila retenida ya lleva su problema, así que el impedimento de la
 * misma fila no se repite; tampoco dos líneas con el mismo texto.
 */
export function summarizeCompletion(
  blockers: readonly CompletionBlocker[],
  held: readonly HeldRow[],
): CompletionSummary {
  const lines: CompletionSummaryLine[] = held.map((row) => ({ key: row.key, text: row.problem, held: true }))
  const seenKeys = new Set(held.map((row) => row.key))
  const seenText = new Set(lines.map((line) => line.text))
  for (const blocker of blockers) {
    const key = blocker.sectionId && blocker.itemId ? captureKey(blocker.sectionId, blocker.itemId) : null
    if (key ? seenKeys.has(key) : seenText.has(blocker.detail)) continue
    if (key) seenKeys.add(key)
    seenText.add(blocker.detail)
    lines.push({ key, text: blocker.detail, held: false })
  }
  return {
    lines,
    firstKey: lines.find((line) => line.key !== null)?.key ?? null,
    heldCount: held.length,
    canComplete: lines.length === 0,
  }
}
