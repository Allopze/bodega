"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useDebouncedAutosave, type AutosaveFailure } from "@/lib/hooks/use-debounced-autosave"
import type { OperationResult } from "@/lib/hooks/use-operation"
import {
  buildAnswersPayload,
  captureKey,
  classifySaveFailure,
  diffDrafts,
  draftsFromAnswers,
  rebaseDrafts,
  sameAnswerSet,
  saveErrorCodeOf,
  type CaptureSaveState,
  type HeldRow,
  type SaveFailureInfo,
} from "@/lib/prevention/inspection-capture"
import { clearInspectionDraft, clearInspectionDraftsOfRun } from "@/lib/prevention/inspection-draft-storage"
import type { ClosingActSpec, InspectionAnswerInput, InspectionItemSpec } from "@/lib/prevention/inspections"
import { useOnlineStatus } from "@/lib/pwa/use-online-status"
import { toast } from "@/lib/toast"
import {
  completeInspectionRunAction,
  saveInspectionAnswersAction,
  saveInspectionParticipantsAction,
} from "../../actions"
import type { AnswerInfo, Draft, RunInfo } from "../_components/types"
import type { GeoCoords } from "./use-geolocation"
import { draftsFromAnswerInfos, useDraftMirror, type InspectionDraftApi } from "./use-inspection-draft"
import { useOfflineCloseQueue } from "./use-offline-close-queue"

/**
 * El único canal por el que las respuestas de una inspección salen hacia el
 * servidor.
 *
 * Antes eran cuatro que no se coordinaban —autoguardado, botón «Guardar», cola
 * del cierre sin conexión y adjuntar una foto— y competían por el mismo
 * `expectedVersion`: el que llegaba segundo se rechazaba por conflicto, y de
 * ahí salían un guardado que decía «Guardado» sin serlo (P0-1), una fila mala
 * que frenaba todas las demás (P1-1), un bucle de reintentos contra un rechazo
 * permanente (P1-4) y un cierre en cola que se quemaba por conflicto con el
 * propio autoguardado (P1-5).
 *
 * Aquí todo pasa por `useDebouncedAutosave` (que serializa: nunca hay dos
 * guardados en vuelo), la versión se lleva en un ref con `max()`, y lo que se
 * considera guardado es el payload realmente enviado y no lo que hay en pantalla.
 */

type DraftMap = Record<string, Draft>

type PersistedMap = Record<string, InspectionAnswerInput>

function trimmedOrNull(text: string | null | undefined): string | null {
  const trimmed = text?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}

/** Lo que el servidor tiene, por clave; sólo de ítems que la plantilla todavía declara. */
function answersToPersisted(answers: readonly AnswerInfo[], itemKeys: ReadonlySet<string>): PersistedMap {
  const persisted: PersistedMap = {}
  for (const answer of answers) {
    const key = captureKey(answer.sectionId, answer.itemId)
    if (!itemKeys.has(key) || answer.result === "") continue
    persisted[key] = {
      sectionId: answer.sectionId,
      itemId: answer.itemId,
      result: answer.result as InspectionAnswerInput["result"],
      comment: trimmedOrNull(answer.comment),
      value: trimmedOrNull(answer.value),
      needsConfirmation: answer.needsConfirmation ?? false,
    }
  }
  return persisted
}

function byKey(answers: readonly InspectionAnswerInput[]): PersistedMap {
  const map: PersistedMap = {}
  for (const answer of answers) map[captureKey(answer.sectionId, answer.itemId)] = answer
  return map
}

function coordsDiffer(a: GeoCoords | null | undefined, b: GeoCoords | null | undefined): boolean {
  return (a?.lat ?? null) !== (b?.lat ?? null) || (a?.lon ?? null) !== (b?.lon ?? null)
}

function sameIds(a: Record<string, string>, b: Record<string, string>): boolean {
  const left = Object.keys(a)
  return left.length === Object.keys(b).length && left.every((key) => a[key] === b[key])
}

/**
 * ¿La Server Action falló por la red? Sólo cuenta `navigator.onLine === false` o
 * el `TypeError` de `fetch`: un `TypeError` de programación no puede decir
 * «Sin conexión» (misma regla que `useOperation`).
 */
function isNetworkFailure(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true
  return error instanceof TypeError && /failed to fetch|fetch failed|network|load failed/i.test(error.message)
}

/** Cuántos envíos sin confirmar se recuerdan: más allá de esto la señal lleva horas caída y ya hay otro aviso. */
const MAX_UNCONFIRMED_SENDS = 10

function versionOf(result: { data?: Record<string, unknown> } | null | undefined): number | null {
  const version = result?.data?.version
  return typeof version === "number" ? version : null
}

export interface UseInspectionSaveChannelOptions {
  run: Pick<RunInfo, "id" | "version" | "locationLatitude" | "locationLongitude">
  items: InspectionItemSpec[]
  /** Lo que el servidor tiene guardado (puede refrescarse con `router.refresh()`). */
  answers: readonly AnswerInfo[]
  draft: InspectionDraftApi
  closingAct: ClosingActSpec | null
  currentUserId: string
  /** La ejecución admite edición: `canExecute` y estado `planned`/`in_progress`. */
  editable: boolean
  canExecute: boolean
}

export function useInspectionSaveChannel({
  run, items, answers, draft, closingAct, currentUserId, editable, canExecute,
}: UseInspectionSaveChannelOptions) {
  const router = useRouter()
  const online = useOnlineStatus()
  // Las piezas estables del borrador: el objeto `draft` cambia en cada render.
  const { draftsRef, coordsRef, closingRef, setDrafts, setCoords, bump } = draft

  const itemKeys = React.useMemo(() => new Set(items.map((item) => captureKey(item.sectionId, item.itemId))), [items])

  /* ── Versión ───────────────────────────────────────────────────────────────
   * El CAS del siguiente envío usa la que devolvió el servidor, no la de las
   * props, que queda atrás en cuanto se guarda una vez. Se actualiza de forma
   * síncrona y con `max()`: una versión de las props más vieja que la local no
   * gana. El estado existe sólo para pintarla (los diálogos la reciben). */
  const [version, setVersion] = React.useState(run.version)
  const versionRef = React.useRef(run.version)
  const adoptVersion = React.useCallback((next: number) => {
    if (next > versionRef.current) {
      versionRef.current = next
      setVersion(next)
    }
  }, [])
  /** Para `onVersion` de los paneles y `onDone` de los diálogos; tolera que no venga `data.version`. */
  const applyVersion = React.useCallback((result: { data?: Record<string, unknown> }) => {
    const next = versionOf(result)
    if (next !== null) adoptVersion(next)
  }, [adoptVersion])

  /* ── Lo que el servidor tiene ────────────────────────────────────────────── */
  const [persisted, setPersistedState] = React.useState<PersistedMap>(() => answersToPersisted(answers, itemKeys))
  const persistedRef = React.useRef(persisted)
  const setPersisted = React.useCallback((next: PersistedMap) => {
    persistedRef.current = next
    setPersistedState(next)
  }, [])
  const [persistedCoords, setPersistedCoordsState] = React.useState<GeoCoords | null>(() =>
    run.locationLatitude && run.locationLongitude ? { lat: run.locationLatitude, lon: run.locationLongitude } : null,
  )
  const persistedCoordsRef = React.useRef(persistedCoords)
  const setPersistedCoords = React.useCallback((next: GeoCoords | null) => {
    persistedCoordsRef.current = next
    setPersistedCoordsState(next)
  }, [])
  const persistedList = React.useMemo(() => Object.values(persisted), [persisted])
  const persistedDrafts = React.useMemo(() => draftsFromAnswers(persistedList), [persistedList])

  /**
   * Lo que viajó en el envío en vuelo (el último de la lista) y en los que no
   * llegaron a confirmarse desde el último guardado: si el servidor devuelve
   * alguno de ellos, es un cambio propio. Hay que conservarlos todos: un envío
   * pudo aplicarse con la respuesta perdida (sin señal), la persona siguió
   * escribiendo y el reintento choca contra su propio guardado.
   */
  const sentRef = React.useRef<{ answers: InspectionAnswerInput[]; coords: GeoCoords | null }[]>([])

  /* ── Ids de respuesta y fotos ────────────────────────────────────────────── */
  const [answerIds, setAnswerIdsState] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(answers.map((answer) => [captureKey(answer.sectionId, answer.itemId), answer.answerId])),
  )
  const answerIdsRef = React.useRef(answerIds)
  const mergeAnswerIds = React.useCallback((incoming: Record<string, string>) => {
    const next = { ...answerIdsRef.current, ...incoming }
    if (sameIds(next, answerIdsRef.current)) return
    answerIdsRef.current = next
    setAnswerIdsState(next)
  }, [])

  const latestAnswersRef = React.useRef(answers)
  const latestVersionRef = React.useRef(run.version)
  const [photoOverrides, setPhotoOverridesState] = React.useState<Record<string, number>>({})
  const photoOverridesRef = React.useRef(photoOverrides)
  const serverPhotoCounts = React.useMemo(() => serverCountsOf(answers), [answers])
  const photoCountByKey = React.useMemo(() => ({ ...serverPhotoCounts, ...photoOverrides }), [serverPhotoCounts, photoOverrides])
  const evidenceByKey = React.useMemo(
    () => new Map(answers.map((answer) => [captureKey(answer.sectionId, answer.itemId), answer.evidence])),
    [answers],
  )

  /** Fotos de la respuesta tras subir o quitar una; también destraba una fila retenida por fotos. */
  const onEvidenceChange = React.useCallback((key: string, count: number) => {
    const next = { ...photoOverridesRef.current, [key]: count }
    photoOverridesRef.current = next
    setPhotoOverridesState(next)
    // Cambia lo que se enviaría sin tocar ninguna respuesta: hay que avisarle
    // al autoguardado, o una fila retenida por sus fotos no se libera nunca.
    bump()
  }, [bump])

  /* ── Qué se enviaría ─────────────────────────────────────────────────────── */
  const built = React.useMemo(
    () => buildAnswersPayload({ items, drafts: draft.drafts, persisted, photoCountByKey }),
    [items, draft.drafts, persisted, photoCountByKey],
  )
  const held: HeldRow[] = built.held
  const coordsDirty = coordsDiffer(draft.coords, persistedCoords)
  /* `isDirty` se deriva: lo que se enviaría frente a lo que el servidor tiene.
   * Así «Guardado» sólo aparece cuando lo que ve la persona es lo que el
   * servidor tiene (P0-1). Las filas retenidas NO cuentan: recrearían el bucle
   * de reintentos contra una fila que el servidor va a rechazar siempre. */
  const isDirty = !sameAnswerSet(built.answers, persistedList) || coordsDirty

  /** Lo mismo, pero desde los refs: para el envío, que corre fuera de un render. */
  const buildNow = React.useCallback(() => buildAnswersPayload({
    items,
    drafts: draftsRef.current,
    persisted: persistedRef.current,
    photoCountByKey: { ...serverCountsOf(latestAnswersRef.current), ...photoOverridesRef.current },
  }), [items, draftsRef])

  /* ── Estado de bloqueo ───────────────────────────────────────────────────── */
  const [conflict, setConflictState] = React.useState(false)
  const conflictRef = React.useRef(false)
  const setConflict = React.useCallback((next: boolean) => {
    conflictRef.current = next
    setConflictState(next)
  }, [])
  const [notEditable, setNotEditableState] = React.useState(false)
  const notEditableRef = React.useRef(false)
  const [completing, setCompletingState] = React.useState(false)
  const setCompleting = setCompletingState
  /** El cierre ya llegó al servidor: no hay nada más que enviar ni que guardar en el dispositivo. */
  const [finished, setFinished] = React.useState(false)
  const [failureInfo, setFailureInfo] = React.useState<SaveFailureInfo | null>(null)
  /** El último fallo, para saber si fue la red al cerrar. */
  const lastFailureRef = React.useRef<{ thrown: boolean; info: SaveFailureInfo } | null>(null)
  const [resyncing, setResyncing] = React.useState(false)
  const resyncRef = React.useRef<"recover" | "discard" | null>(null)

  /* ── La ejecución vuelve a ser editable ────────────────────────────────────
   * `finished`, `completing` y `notEditable` sólo se encienden: declarar
   * ejecutada, o un «ya no se puede editar», pausan el canal. Si la inspección se
   * reabre sin salir de la pantalla (rectificar una ejecución declarada por
   * error), esos bloqueos ya no valen y, sin reiniciarlos, el autoguardado y el
   * espejo del dispositivo seguían apagados y la etiqueta decía «Declarando
   * ejecutada…». Se reinician al pasar de no editable a editable —no en cada
   * cambio de estado: planificada → en curso llega con el refresco de un guardado
   * y no puede soltar un cierre en marcha— y la revisión nueva reintenta lo que
   * hubiera quedado sin enviar. */
  const wasEditableRef = React.useRef(editable)
  React.useEffect(() => {
    const was = wasEditableRef.current
    wasEditableRef.current = editable
    if (was || !editable) return
    notEditableRef.current = false
    setNotEditableState(false)
    setCompletingState(false)
    setFinished(false)
    lastFailureRef.current = null
    setFailureInfo(null)
    bump()
  }, [editable, bump])

  /* ── Cierre sin conexión ─────────────────────────────────────────────────── */
  const onDelivered = React.useCallback((result: { data?: Record<string, unknown> }) => {
    const next = versionOf(result)
    if (next !== null) adoptVersion(next)
    // Hasta que las props refresquen la pantalla no debe volver a escribirse el espejo.
    setFinished(true)
    clearInspectionDraftsOfRun(run.id)
    toast.success("Cierre enviado: la inspección quedó declarada ejecutada.")
  }, [adoptVersion, run.id])
  const queue = useOfflineCloseQueue({
    runId: run.id,
    userId: currentUserId,
    enabled: canExecute,
    send: (payload) => completeInspectionRunAction(payload),
    onDelivered,
  })
  /* Mientras haya un cierre guardado —o aún no se sepa si lo hay—, el
   * autoguardado se pausa y la edición se bloquea: los dos canales competirían
   * por el mismo `expectedVersion`. Sólo el cierre guardado bloquea la edición;
   * esperar la lectura inicial es cosa de milisegundos y no justifica apagar
   * los controles. */
  const locked = queue.entry !== null

  /* ── Autoguardado ────────────────────────────────────────────────────────── */
  async function sendAnswers() {
    const { answers: toSend } = buildNow()
    const coords = coordsRef.current
    sentRef.current = [...sentRef.current, { answers: toSend, coords }].slice(-MAX_UNCONFIRMED_SENDS)
    return saveInspectionAnswersAction({
      runId: run.id,
      expectedVersion: versionRef.current,
      answers: toSend,
      locationLatitude: coords?.lat ?? null,
      locationLongitude: coords?.lon ?? null,
    })
  }

  function onSaved(result: { data?: Record<string, unknown> }) {
    applyVersion(result)
    const refs = result.data?.answerRefs
    if (Array.isArray(refs)) {
      const incoming: Record<string, string> = {}
      for (const value of refs) {
        if (!value || typeof value !== "object") continue
        const row = value as { answerId?: unknown; sectionId?: unknown; itemId?: unknown }
        if (typeof row.answerId === "string" && typeof row.sectionId === "string" && typeof row.itemId === "string") {
          incoming[captureKey(row.sectionId, row.itemId)] = row.answerId
        }
      }
      mergeAnswerIds(incoming)
    }
    // Lo guardado es lo realmente enviado, no lo que haya en pantalla ahora.
    const sent = sentRef.current[sentRef.current.length - 1]
    if (sent) {
      setPersisted(byKey(sent.answers))
      setPersistedCoords(sent.coords)
    }
    // Confirmado el último, los anteriores ya no son candidatos a «lo mío».
    sentRef.current = []
    lastFailureRef.current = null
    setFailureInfo(null)
    setConflict(false)
  }

  function onFailed(failure: AutosaveFailure) {
    const thrown = failure.result === null
    const info = classifySaveFailure(failure.result, {
      thrown,
      online: typeof navigator === "undefined" ? true : navigator.onLine,
    })
    lastFailureRef.current = { thrown, info }
    setFailureInfo(info)
    if (info.code === "version_conflict") {
      setConflict(true)
      // Trae lo del servidor de una vez: «Recuperar mis cambios» lo necesita.
      router.refresh()
    } else if (info.code === "not_editable") {
      notEditableRef.current = true
      setNotEditableState(true)
    }
  }

  const autosave = useDebouncedAutosave({
    watchKey: draft.revision,
    isDirty,
    onSave: sendAnswers,
    onSaved,
    onFailed,
    isTransient: (result) => classifySaveFailure(result).transient,
    // Pausar (conflicto, cierre, cierre guardado) no debe dejar salir de la
    // página con trabajo sin enviar sin avisar.
    hasUnsavedWork: isDirty || held.length > 0 || draft.participants.dirty,
    enabled: editable && draft.hydrated && queue.loaded && !conflict && !notEditable && !completing && !locked && !finished,
    debounceMs: 1200,
  })

  /* ── Espejo en el dispositivo ────────────────────────────────────────────── */
  const { mirrorFailed } = useDraftMirror({
    draft,
    runId: run.id,
    userId: currentUserId,
    enabled: editable && canExecute && !finished,
    version,
    persistedDrafts,
    persistedCoords,
  })

  /* ── Cambios de las props (refresh del servidor) ─────────────────────────── */
  const lastPropsVersionRef = React.useRef(run.version)
  const propsCoordsRef = React.useRef<GeoCoords | null>(null)
  React.useEffect(() => {
    latestAnswersRef.current = answers
    latestVersionRef.current = run.version
    propsCoordsRef.current = run.locationLatitude && run.locationLongitude
      ? { lat: run.locationLatitude, lon: run.locationLongitude }
      : null
  })

  /** Hay algo en pantalla que el servidor no tiene (incluye filas retenidas). */
  const hasLocalUnsent = React.useCallback(() => (
    diffDrafts(draftsRef.current, draftsFromAnswers(Object.values(persistedRef.current))).length > 0
    || coordsDiffer(coordsRef.current, persistedCoordsRef.current)
  ), [draftsRef, coordsRef])

  const adoptServer = React.useCallback((server: PersistedMap, serverVersion: number) => {
    adoptVersion(serverVersion)
    setPersisted(server)
    const serverCoords = propsCoordsRef.current
    if (serverCoords) {
      // Otra sesión capturó la ubicación y aquí no se había tocado: se adopta
      // también en pantalla. Sólo en el servidor dejaba la pantalla «sucia» y
      // mandaba un guardado inútil con coordenadas nulas.
      if (!coordsDiffer(coordsRef.current, persistedCoordsRef.current)) setCoords(serverCoords)
      setPersistedCoords(serverCoords)
    }
    const wasConflict = conflictRef.current
    setConflict(false)
    if (wasConflict) {
      // El conflicto se resolvió con lo que llegó (o por la vía de recuperar o
      // descartar): el rechazo anterior ya no describe la pantalla, y lo que
      // quede sin enviar se reintenta con la versión vigente.
      lastFailureRef.current = null
      setFailureInfo(null)
      bump()
    }
  }, [adoptVersion, setPersisted, setPersistedCoords, setConflict, setCoords, coordsRef, bump])

  const applyResync = React.useCallback((kind: "recover" | "discard") => {
    const serverAnswers = latestAnswersRef.current
    const server = answersToPersisted(serverAnswers, itemKeys)
    const serverDrafts = draftsFromAnswerInfos(serverAnswers)
    if (kind === "recover") {
      // Lo que la persona cambió gana; lo que no tocó se queda con lo del otro inspector.
      setDrafts(rebaseDrafts({
        server: serverDrafts,
        oldPersisted: draftsFromAnswers(Object.values(persistedRef.current)),
        local: draftsRef.current,
      }) as DraftMap)
    } else {
      setDrafts(serverDrafts)
      setCoords(propsCoordsRef.current)
      clearInspectionDraft(run.id)
    }
    photoOverridesRef.current = {}
    setPhotoOverridesState({})
    adoptServer(server, latestVersionRef.current)
    resyncRef.current = null
    setResyncing(false)
    // La clave nueva le dice al autoguardado que retome con lo rebasado.
    bump()
  }, [adoptServer, bump, draftsRef, itemKeys, run.id, setCoords, setDrafts])

  React.useEffect(() => {
    // Ids y fotos: siempre al día, aunque la versión no cambie.
    mergeAnswerIds(Object.fromEntries(answers.map((answer) => [captureKey(answer.sectionId, answer.itemId), answer.answerId])))
    // Una versión que no es más nueva que la última vista no trae respuestas nuevas.
    if (run.version <= lastPropsVersionRef.current) {
      // Quien pidió «Recuperar/Descartar» esperaba este refresco: si no trajo
      // nada más nuevo, se aplica con lo que ya hay. Sin esto el botón quedaba
      // ocupado para siempre.
      if (resyncRef.current) applyResync(resyncRef.current)
      return
    }
    lastPropsVersionRef.current = run.version

    const server = answersToPersisted(answers, itemKeys)
    const serverList = Object.values(server)
    // Las respuestas del servidor igualan lo persistido o alguno de los envíos
    // sin confirmar: es un cambio propio (o ajeno que no tocó respuestas, como
    // un participante).
    if (
      sameAnswerSet(serverList, Object.values(persistedRef.current))
      || sentRef.current.some((sent) => sameAnswerSet(serverList, sent.answers))
    ) {
      sentRef.current = []
      adoptServer(server, run.version)
      resyncRef.current = null
      setResyncing(false)
      return
    }
    if (!hasLocalUnsent()) {
      // Alguien más guardó y esta pantalla no tiene nada propio sin enviar: se pone al día.
      setDrafts(draftsFromAnswerInfos(answers))
      photoOverridesRef.current = {}
      setPhotoOverridesState({})
      adoptServer(server, run.version)
      resyncRef.current = null
      setResyncing(false)
      return
    }
    // Hay trabajo propio sin enviar sobre una versión que ya no es la vigente.
    setConflict(true)
    if (resyncRef.current) applyResync(resyncRef.current)
  }, [run.version, answers, itemKeys, adoptServer, applyResync, hasLocalUnsent, mergeAnswerIds, setDrafts, setConflict])

  /** «Recuperar mis cambios» / «Descartar mis cambios»: con las props al día se aplica al instante; si no, se refresca y se aplica al llegar. */
  function requestResync(kind: "recover" | "discard") {
    // Sin conflicto vigente no hay nada que esperar: el servidor ya está adoptado.
    if (latestVersionRef.current > versionRef.current || !conflictRef.current) {
      applyResync(kind)
      return
    }
    resyncRef.current = kind
    setResyncing(true)
    router.refresh()
  }

  /* ── Acciones ────────────────────────────────────────────────────────────── */

  /** «Guardar»: guarda ya, espera lo que esté en vuelo y nunca lanza. */
  async function save() {
    const result = await autosave.saveNow()
    if (result?.ok) toast.success("Respuestas guardadas.")
    return result
  }

  /**
   * Para adjuntar una foto: la respuesta tiene que existir en el servidor.
   * Pasa por el mismo canal de guardado y no llama a la acción por su cuenta.
   */
  async function ensureAnswerId(key: string): Promise<string> {
    if (conflictRef.current) throw new Error("La inspección cambió en otra sesión: recupera o descarta tus cambios antes de adjuntar fotos.")
    if (notEditableRef.current) throw new Error("La inspección ya no se puede editar.")
    if (buildNow().held.some((row) => row.key === key)) throw new Error("Completa el motivo antes de adjuntar fotos.")
    const result = await autosave.saveNow()
    if (result && !result.ok) throw new Error(result.message ?? "No se pudo guardar la respuesta.")
    const id = answerIdsRef.current[key]
    if (!id) throw new Error("No se encontró la respuesta guardada.")
    return id
  }

  function completePayload(toSend: InspectionAnswerInput[]) {
    const coords = coordsRef.current
    const act = closingRef.current
    return {
      runId: run.id,
      expectedVersion: versionRef.current,
      answers: toSend,
      locationLatitude: coords?.lat ?? null,
      locationLongitude: coords?.lon ?? null,
      closingAct: closingAct
        ? {
            result: act.result,
            restrictions: act.restrictions || null,
            signatures: act.signatures.filter((item) => item.name.trim().length > 0),
          }
        : undefined,
    }
  }

  /**
   * Declara ejecutada: pausa el autoguardado, deja guardado lo último, guarda
   * los participantes si quedaron sin guardar y manda el cierre. Nunca lanza: un
   * rechazo o una excepción vuelven como `ok: false` con su mensaje, y la caída
   * de la red con `offline: true` para ofrecer guardarlo en el dispositivo.
   */
  async function complete(): Promise<OperationResult> {
    setCompleting(true)
    let succeeded = false
    try {
      const flushed = await autosave.flush()
      if (flushed && !flushed.ok) {
        const last = lastFailureRef.current
        return last?.thrown
          ? { ok: false, offline: true, message: "Sin conexión: no se pudieron guardar las últimas respuestas." }
          : { ok: false, message: flushed.message ?? "No se pudieron guardar las respuestas." }
      }
      const { answers: toSend, held: stillHeld } = buildNow()
      if (stillHeld.length > 0) {
        return { ok: false, message: "Hay respuestas incompletas que todavía no se guardan: complétalas antes de declarar ejecutada." }
      }
      if (draft.participants.dirtyRef.current) {
        const saved = await saveInspectionParticipantsAction({
          runId: run.id,
          participants: draft.participants.rowsRef.current ?? [],
        })
        if (!saved.ok) return { ok: false, message: saved.message ?? "No se pudieron guardar los participantes." }
        draft.participants.markSaved()
      }
      const result = await completeInspectionRunAction(completePayload(toSend))
      if (!result.ok) {
        const code = saveErrorCodeOf(result)
        if (code === "version_conflict") {
          setConflict(true)
          router.refresh()
        } else if (code === "not_editable") {
          notEditableRef.current = true
          setNotEditableState(true)
        }
        return result
      }
      applyVersion(result)
      // Declarada ejecutada: el borrador del dispositivo ya no aplica, en ninguna pestaña.
      clearInspectionDraftsOfRun(run.id)
      succeeded = true
      setFinished(true)
      return result
    } catch (error) {
      // La acción no respondió: sin red se ofrece guardar el cierre en el
      // dispositivo; otra excepción no dice «Sin conexión».
      return isNetworkFailure(error)
        ? { ok: false, offline: true, message: "Sin conexión: no se pudo enviar el cierre. Revisa la señal e inténtalo de nuevo." }
        : { ok: false, message: "No se pudo declarar ejecutada la inspección. Inténtalo de nuevo." }
    } finally {
      if (!succeeded) setCompleting(false)
    }
  }

  /** Sin conexión: el cierre queda en el dispositivo y se envía solo al volver la señal. */
  async function queueClose(): Promise<{ ok: boolean; message?: string }> {
    const { answers: toSend, held: stillHeld } = buildNow()
    if (stillHeld.length > 0) return { ok: false, message: "Hay respuestas incompletas: complétalas antes de guardar el cierre." }
    const stored = await queue.queue(completePayload(toSend))
    return stored.ok ? { ok: true } : { ok: false, message: stored.message }
  }

  /** «Recuperar el cierre»: devuelve a la pantalla lo que se había guardado para enviar. */
  async function recoverQueuedClose() {
    const entry = queue.entry
    if (!entry) return
    draft.applySubmission(entry.payload)
    await queue.discard()
  }

  /* ── Estado que se muestra ───────────────────────────────────────────────── */
  const failure = autosave.failure
  const failureState = failure ? failureInfo?.state ?? null : null
  let captureState: CaptureSaveState
  if (queue.entry) {
    captureState = queue.entry.rejected
      ? { kind: "rejected", message: queue.entry.lastError ?? "No se pudo enviar el cierre." }
      : { kind: "queued_close" }
  } else if (completing || finished) captureState = { kind: "closing" }
  else if (notEditable) captureState = { kind: "not_editable" }
  else if (conflict) captureState = { kind: "conflict" }
  else if (autosave.status === "saving") captureState = { kind: "saving" }
  else if (failureState) captureState = failureState
  else if (!online && isDirty) captureState = { kind: "offline" }
  else if (isDirty || draft.pendingRestore) captureState = { kind: "dirty" }
  else captureState = { kind: "saved", heldCount: held.length }

  return {
    version,
    applyVersion,
    captureState,
    isDirty,
    held,
    online,
    mirrorFailed,
    locked,
    conflict,
    notEditable,
    resyncing,
    saving: autosave.status === "saving",
    answerIds,
    evidenceByKey,
    onEvidenceChange,
    ensureAnswerId,
    save,
    retry: save,
    recoverConflict: () => requestResync("recover"),
    discardConflict: () => requestResync("discard"),
    viewCurrent: () => router.refresh(),
    complete,
    queueClose,
    queue: {
      entry: queue.entry,
      loaded: queue.loaded,
      sending: queue.sending,
      sendNow: queue.sendNow,
      discard: queue.discard,
      recover: recoverQueuedClose,
    },
  }
}

/** Fotos persistidas por clave, tal como las trajo el servidor. */
function serverCountsOf(answers: readonly AnswerInfo[]): Record<string, number> {
  return Object.fromEntries(answers.map((answer) => [captureKey(answer.sectionId, answer.itemId), answer.evidence.length]))
}
