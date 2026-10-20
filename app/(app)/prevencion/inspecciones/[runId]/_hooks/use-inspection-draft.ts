"use client"

import * as React from "react"
import {
  captureKey,
  diffDrafts,
  rebaseDrafts,
  type CaptureDraft,
} from "@/lib/prevention/inspection-capture"
import {
  clearInspectionDraft,
  inspectionDraftKey,
  purgeInspectionDrafts,
  readInspectionDrafts,
  writeInspectionDraft,
  type InspectionDraftInput,
  type InspectionDraftRow,
  type InspectionDraftSnapshot,
  type StoredInspectionDraft,
} from "@/lib/prevention/inspection-draft-storage"
import type { ClosingActInput, ClosingActSpec } from "@/lib/prevention/inspections"
import type { AnswerInfo, Draft, ResultValue, RunInfo } from "../_components/types"
import type { OfflineInspectionSubmission } from "../offline-inspection-queue"
import type { GeoCoords } from "./use-geolocation"

/**
 * Lo que la persona ve y edita en la pantalla de ejecución, y su espejo en el
 * dispositivo (INS-02).
 *
 * Aquí viven los borradores de las respuestas, el acta de cierre, la ubicación
 * y los participantes —todo lo que la persona teclea y todavía no es del
 * servidor—, más la restauración del espejo al montar. Cuándo y cómo se envía
 * lo decide `useInspectionSaveChannel`; este hook sólo sabe qué hay en pantalla.
 *
 * Los valores se guardan DOS veces a propósito: en estado, para pintar, y en un
 * ref que se actualiza en el mismo instante de la edición. El envío corre desde
 * temporizadores y tras un `await`, donde la función de un render anterior
 * vería borradores viejos: lo que se manda sale siempre del ref.
 */

export interface ParticipantDraft {
  id: string
  name: string
  position: string
  userId: string | null
}

type DraftMap = Record<string, Draft>

const EMPTY_DRAFT: Draft = { result: "", comment: "", value: "", needsConfirmation: false }

/** El borrador que corresponde a lo que el servidor ya tiene. */
export function draftsFromAnswerInfos(answers: readonly AnswerInfo[]): DraftMap {
  const drafts: DraftMap = {}
  for (const answer of answers) {
    drafts[captureKey(answer.sectionId, answer.itemId)] = {
      result: answer.result as ResultValue,
      comment: answer.comment ?? "",
      value: answer.value ?? "",
      needsConfirmation: answer.needsConfirmation ?? false,
    }
  }
  return drafts
}

function draftFromRow(row: InspectionDraftRow): Draft {
  return {
    result: row.result as ResultValue,
    comment: row.comment ?? "",
    value: row.value ?? "",
    needsConfirmation: row.needsConfirmation ?? false,
  }
}

function closingFromRun(
  run: Pick<RunInfo, "closingResult" | "closingRestrictions" | "closingSignatures">,
  spec: ClosingActSpec | null,
): ClosingActInput {
  return {
    result: run.closingResult ?? "",
    restrictions: run.closingRestrictions ?? "",
    signatures: (spec?.signatureRoles ?? []).map((role) => {
      const saved = run.closingSignatures?.find((item) => item.role === role)
      return { role, name: saved?.name ?? "", userId: saved?.userId ?? null }
    }),
  }
}

/** El acta de un espejo o de un cierre guardado, con los roles que declara la plantilla. */
function closingFromStored(
  stored: { result: string; restrictions?: string | null; signatures: { role: string; name: string; userId?: string | null }[] },
  spec: ClosingActSpec | null,
): ClosingActInput {
  return {
    result: stored.result,
    restrictions: stored.restrictions ?? "",
    signatures: (spec?.signatureRoles ?? stored.signatures.map((item) => item.role)).map((role) => {
      const found = stored.signatures.find((item) => item.role === role)
      return { role, name: found?.name ?? "", userId: found?.userId ?? null }
    }),
  }
}

function closingDiffers(a: ClosingActInput, b: ClosingActInput): boolean {
  if (a.result !== b.result) return true
  if ((a.restrictions ?? "").trim() !== (b.restrictions ?? "").trim()) return true
  const names = (act: ClosingActInput) => JSON.stringify([...act.signatures].map((item) => [item.role, item.name.trim()]).sort())
  return names(a) !== names(b)
}

function coordsDiffer(a: GeoCoords | null | undefined, b: GeoCoords | null | undefined): boolean {
  return (a?.lat ?? null) !== (b?.lat ?? null) || (a?.lon ?? null) !== (b?.lon ?? null)
}

/** Igual que `participantsKey` del panel: el `id` lo reasigna el servidor, así que no cuenta. */
function participantsKey(rows: readonly ParticipantDraft[]): string {
  return JSON.stringify(rows.map((row) => [row.name.trim(), row.position.trim(), row.userId]))
}

function baseOf(snapshot: InspectionDraftSnapshot): Record<string, InspectionDraftRow> {
  return snapshot.base ?? {}
}

/** Cómo se avisa lo que pasó con el espejo del dispositivo al montar. */
export type RestoreNotice =
  | { kind: "applied" }
  | { kind: "not_editable"; statusLabel: string }

/** Espejo que no se pudo aplicar sobre la versión actual y espera decisión. */
export interface PendingRestore {
  /** Cuántas respuestas difieren de lo que hay en el servidor. */
  count: number
}

export interface UseInspectionDraftOptions {
  run: Pick<
    RunInfo,
    "id" | "version" | "status" | "closingResult" | "closingRestrictions" | "closingSignatures" | "locationLatitude" | "locationLongitude"
  >
  /** Lo que el servidor tiene guardado. */
  answers: readonly AnswerInfo[]
  closingAct: ClosingActSpec | null
  participants: readonly ParticipantDraft[]
  currentUserId: string
  canExecute: boolean
  /** «Revisada y cerrada», «Cancelada»…: para decir por qué ya no se puede aplicar un espejo. */
  statusLabel: string
}

export type InspectionDraftApi = ReturnType<typeof useInspectionDraft>

export function useInspectionDraft({
  run, answers, closingAct, participants, currentUserId, canExecute, statusLabel,
}: UseInspectionDraftOptions) {
  const [drafts, setDraftsState] = React.useState<DraftMap>(() => draftsFromAnswerInfos(answers))
  const draftsRef = React.useRef(drafts)

  const [closing, setClosingState] = React.useState<ClosingActInput>(() => closingFromRun(run, closingAct))
  const closingRef = React.useRef(closing)
  const [closingBaseline] = React.useState<ClosingActInput>(closing)

  const [coords, setCoordsState] = React.useState<GeoCoords | null>(() =>
    run.locationLatitude && run.locationLongitude ? { lat: run.locationLatitude, lon: run.locationLongitude } : null,
  )
  const coordsRef = React.useRef(coords)

  /* INS-02: sube en cada edición. Es lo que vigila el autoguardado, y sube
   * también con el acta, la ubicación y los participantes: cambiar la clave le
   * dice al hook que lo anterior ya no vale (por ejemplo un rechazo permanente). */
  const [revision, setRevision] = React.useState(0)
  const bump = React.useCallback(() => setRevision((value) => value + 1), [])

  const [participantRows, setParticipantRows] = React.useState<ParticipantDraft[] | null>(null)
  const [participantsDirty, setParticipantsDirty] = React.useState(false)
  /** Filas que se le ordena adoptar al panel (las del espejo o las de un cierre recuperado). */
  const [initialParticipantRows, setInitialParticipantRows] = React.useState<ParticipantDraft[] | undefined>(undefined)
  const participantRowsRef = React.useRef<ParticipantDraft[] | null>(null)
  const participantsDirtyRef = React.useRef(false)

  const [hydrated, setHydrated] = React.useState(false)
  const [restoreNotice, setRestoreNotice] = React.useState<RestoreNotice | null>(null)
  const [pendingRestore, setPendingRestore] = React.useState<PendingRestore | null>(null)
  const pendingSnapshotRef = React.useRef<InspectionDraftSnapshot | null>(null)

  const setDrafts = React.useCallback((next: DraftMap) => {
    draftsRef.current = next
    setDraftsState(next)
  }, [])
  const setClosing = React.useCallback((next: ClosingActInput) => {
    closingRef.current = next
    setClosingState(next)
  }, [])
  const setCoords = React.useCallback((next: GeoCoords | null) => {
    coordsRef.current = next
    setCoordsState(next)
  }, [])

  const update = React.useCallback((sectionId: string, itemId: string, patch: Partial<Draft>) => {
    const key = captureKey(sectionId, itemId)
    const base = draftsRef.current[key] ?? EMPTY_DRAFT
    // Responder el ítem lo ratifica: si la persona eligió el resultado, ya
    // miró la celda. Editar sólo el comentario no basta.
    const confirmedByAnswering = patch.result !== undefined
    setDrafts({
      ...draftsRef.current,
      [key]: { ...base, ...patch, needsConfirmation: confirmedByAnswering ? false : base.needsConfirmation },
    })
    bump()
  }, [setDrafts, bump])

  /** Ratifica lo que leyó la máquina sin cambiar la respuesta. */
  const confirmRead = React.useCallback((sectionId: string, itemId: string) => {
    const key = captureKey(sectionId, itemId)
    const base = draftsRef.current[key]
    if (!base) return
    setDrafts({ ...draftsRef.current, [key]: { ...base, needsConfirmation: false } })
    bump()
  }, [setDrafts, bump])

  const updateClosing = React.useCallback((updater: (current: ClosingActInput) => ClosingActInput) => {
    setClosing(updater(closingRef.current))
    bump()
  }, [setClosing, bump])

  /** La ubicación sube la revisión: es un cambio sin enviar igual que una respuesta. */
  const changeCoords = React.useCallback((next: GeoCoords | null) => {
    setCoords(next)
    bump()
  }, [setCoords, bump])

  /** Lo que el panel de participantes informa cada vez que cambian las filas o se guardan. */
  const onParticipantsChange = React.useCallback((rows: ParticipantDraft[], dirty: boolean) => {
    participantRowsRef.current = rows
    participantsDirtyRef.current = dirty
    setParticipantRows(rows)
    setParticipantsDirty(dirty)
    bump()
  }, [bump])

  /** Los participantes ya se guardaron desde afuera del panel (al declarar ejecutada). */
  const markParticipantsSaved = React.useCallback(() => {
    participantsDirtyRef.current = false
    setParticipantsDirty(false)
  }, [])

  /* ── Restauración del espejo ───────────────────────────────────────────────
   * Una sola vez, en un efecto y con un ref de guarda: StrictMode monta dos
   * veces, y hacerlo durante el render produciría un cuadro distinto en el
   * servidor y en el cliente (error de hidratación).
   *
   *   de otro usuario o de hace más de 30 días, de CUALQUIER ejecución
   *                                          → se borra al abrir, antes de todo lo demás
   *   sin diferencias con el servidor        → se borra en silencio
   *   de otro usuario                        → se descarta en silencio
   *   la ejecución ya no es editable         → se avisa y se borra
   *   misma versión y hay diferencias        → se aplica y sube la revisión
   *   versión distinta y hay diferencias     → NO se aplica: se aparta y se pregunta
   */
  const restoredRef = React.useRef(false)
  React.useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    // Antes que cualquier otra cosa, y aunque esta persona no pueda ejecutar:
    // los espejos de otras ejecuciones —de otro usuario o abandonados hace
    // semanas— no deben quedar en claro en un equipo compartido.
    purgeInspectionDrafts(currentUserId)
    if (!canExecute) {
      setHydrated(true)
      return
    }
    const stored = readInspectionDrafts(run.id)
    const serverDrafts = draftsFromAnswerInfos(answers)
    const serverClosing = closingFromRun(run, closingAct)
    const serverCoords: GeoCoords | null = run.locationLatitude && run.locationLongitude
      ? { lat: run.locationLatitude, lon: run.locationLongitude }
      : null

    const differences = (snapshot: InspectionDraftSnapshot) => diffDrafts(snapshot.drafts, serverDrafts)
    const hasChanges = (snapshot: InspectionDraftSnapshot) =>
      differences(snapshot).length > 0
      || (snapshot.closing !== undefined && closingDiffers(closingFromStored(snapshot.closing, closingAct), serverClosing))
      || (snapshot.coords != null && coordsDiffer(snapshot.coords, serverCoords))
      || (snapshot.participants !== undefined && participantsKey(snapshot.participants) !== participantsKey(participants))

    let chosen: StoredInspectionDraft | null = null
    for (const entry of stored) {
      // Lo de otro usuario no es de esta persona: un equipo de faena se comparte.
      if (entry.snapshot.userId !== null && entry.snapshot.userId !== currentUserId) {
        clearInspectionDraft(run.id, entry.key)
        continue
      }
      if (!hasChanges(entry.snapshot)) {
        clearInspectionDraft(run.id, entry.key)
        continue
      }
      // El más reciente con algo que rescatar; los demás se quedan donde están
      // y se resolverán en la próxima apertura.
      chosen ??= entry
    }

    if (chosen) {
      const snapshot = chosen.snapshot
      const active = run.status === "planned" || run.status === "in_progress"
      if (!active) {
        setRestoreNotice({ kind: "not_editable", statusLabel: statusLabel.toLowerCase() })
        clearInspectionDraft(run.id, chosen.key)
      } else if (snapshot.version === run.version) {
        const merged: DraftMap = { ...serverDrafts }
        for (const [key, row] of Object.entries(snapshot.drafts)) merged[key] = draftFromRow(row)
        setDrafts(merged)
        if (snapshot.closing) setClosing(closingFromStored(snapshot.closing, closingAct))
        if (snapshot.coords) setCoords(snapshot.coords)
        if (snapshot.participants) {
          participantRowsRef.current = snapshot.participants
          participantsDirtyRef.current = true
          setParticipantRows(snapshot.participants)
          setParticipantsDirty(true)
          setInitialParticipantRows(snapshot.participants)
        }
        // Lo recuperado es trabajo sin enviar: sube la revisión para que el
        // autoguardado lo tome. Sin esto la pantalla decía «Guardado» sobre algo
        // que sólo existía en esta pestaña (P0-1).
        bump()
        setRestoreNotice({ kind: "applied" })
        // Lo de otra pestaña pasa a ser de ésta; el efecto del espejo lo reescribe.
        if (!chosen.ownTab) clearInspectionDraft(run.id, chosen.key)
      } else {
        // Se aparta con otra clave para que las ediciones nuevas no lo pisen
        // mientras la persona decide.
        if (!(chosen.pending && chosen.ownTab)) {
          writeInspectionDraft(run.id, {
            version: snapshot.version,
            savedAt: snapshot.savedAt,
            drafts: snapshot.drafts,
            closing: snapshot.closing,
            coords: snapshot.coords,
            participants: snapshot.participants,
            userId: currentUserId,
            ...(Object.keys(baseOf(snapshot)).length > 0 ? { base: baseOf(snapshot) } : {}),
          }, "pending")
          clearInspectionDraft(run.id, chosen.key)
        }
        pendingSnapshotRef.current = snapshot
        setPendingRestore({ count: differences(snapshot).length })
      }
    }
    setHydrated(true)
  }, [run, answers, closingAct, participants, currentUserId, canExecute, statusLabel, setDrafts, setClosing, setCoords, bump])

  const dismissRestoreNotice = React.useCallback(() => setRestoreNotice(null), [])

  /** «Recuperar mis cambios» sobre un espejo apartado: se aplica encima de lo que hay en pantalla. */
  const recoverPending = React.useCallback(() => {
    const snapshot = pendingSnapshotRef.current
    if (!snapshot) return
    const local: Record<string, CaptureDraft> = {}
    for (const [key, row] of Object.entries(snapshot.drafts)) local[key] = draftFromRow(row)
    const rebased = rebaseDrafts({
      server: draftsRef.current,
      oldPersisted: Object.fromEntries(Object.entries(baseOf(snapshot)).map(([key, row]) => [key, draftFromRow(row)])),
      local,
    })
    setDrafts(rebased as DraftMap)
    if (snapshot.closing) setClosing(closingFromStored(snapshot.closing, closingAct))
    if (snapshot.coords) setCoords(snapshot.coords)
    if (snapshot.participants) {
      participantRowsRef.current = snapshot.participants
      participantsDirtyRef.current = true
      setParticipantRows(snapshot.participants)
      setParticipantsDirty(true)
      setInitialParticipantRows(snapshot.participants)
    }
    clearInspectionDraft(run.id, inspectionDraftKey(run.id, "pending"))
    pendingSnapshotRef.current = null
    setPendingRestore(null)
    bump()
  }, [run.id, closingAct, setDrafts, setClosing, setCoords, bump])

  /** «Descartar» el espejo apartado. */
  const discardPending = React.useCallback(() => {
    clearInspectionDraft(run.id, inspectionDraftKey(run.id, "pending"))
    pendingSnapshotRef.current = null
    setPendingRestore(null)
  }, [run.id])

  /**
   * «Recuperar el cierre»: el cierre guardado en el dispositivo vuelve a ser
   * trabajo en pantalla (respuestas, acta y ubicación) para corregirlo y volver
   * a declararlo.
   */
  const applySubmission = React.useCallback((payload: OfflineInspectionSubmission) => {
    const next: DraftMap = { ...draftsRef.current }
    for (const answer of payload.answers) {
      next[captureKey(answer.sectionId, answer.itemId)] = {
        result: answer.result as ResultValue,
        comment: answer.comment ?? "",
        value: answer.value ?? "",
        needsConfirmation: answer.needsConfirmation ?? false,
      }
    }
    setDrafts(next)
    if (payload.closingAct) setClosing(closingFromStored(payload.closingAct, closingAct))
    if (payload.locationLatitude && payload.locationLongitude) {
      setCoords({ lat: payload.locationLatitude, lon: payload.locationLongitude })
    }
    bump()
  }, [closingAct, setDrafts, setClosing, setCoords, bump])

  const closingChanged = closingDiffers(closing, closingBaseline)

  return {
    drafts,
    draftsRef,
    setDrafts,
    update,
    confirmRead,
    closing,
    closingRef,
    closingChanged,
    updateClosing,
    coords,
    coordsRef,
    changeCoords,
    setCoords,
    revision,
    bump,
    hydrated,
    participants: {
      rows: participantRows,
      rowsRef: participantRowsRef,
      dirty: participantsDirty,
      dirtyRef: participantsDirtyRef,
      initialRows: initialParticipantRows,
      onRowsChange: onParticipantsChange,
      markSaved: markParticipantsSaved,
    },
    restoreNotice,
    dismissRestoreNotice,
    pendingRestore,
    recoverPending,
    discardPending,
    applySubmission,
  }
}

/* ── Espejo en el dispositivo ──────────────────────────────────────────────── */

export interface UseDraftMirrorOptions {
  draft: InspectionDraftApi
  runId: string
  userId: string
  /** Sólo se escribe mientras la ejecución es editable. */
  enabled: boolean
  /** Versión del run sobre la que se construyen los borradores. */
  version: number
  /** Lo que el servidor tiene, como borradores. */
  persistedDrafts: Record<string, CaptureDraft>
  persistedCoords: GeoCoords | null
}

/**
 * Espejo del borrador en el propio dispositivo (INS-02). Se escribe en cada
 * edición, antes y con independencia del autoguardado: en terreno el envío al
 * servidor es justo lo que falla, y el espejo es lo único que sobrevive a
 * cerrar la pestaña sin señal.
 *
 * Se escribe cuando hay algo sin enviar —borradores que difieren de lo
 * persistido (incluidas las filas retenidas), acta, ubicación o participantes— y
 * se borra la clave propia cuando ya no queda nada. Antes de que termine la
 * restauración no hace nada: borraría el espejo que ella todavía tiene que leer.
 *
 * Devuelve `mirrorFailed` si el dispositivo no dejó escribir (cuota llena o
 * almacenamiento bloqueado): la pantalla no puede prometer «se guarda en este
 * dispositivo» cuando no es cierto.
 */
export function useDraftMirror({ draft, runId, userId, enabled, version, persistedDrafts, persistedCoords }: UseDraftMirrorOptions) {
  const [mirrorFailed, setMirrorFailed] = React.useState(false)
  const { drafts, closing, closingChanged, coords, hydrated } = draft
  const participantRows = draft.participants.rows
  const participantsDirty = draft.participants.dirty

  const unsent = React.useMemo(
    () => diffDrafts(drafts, persistedDrafts).length > 0
      || closingChanged
      || coordsDiffer(coords, persistedCoords)
      || participantsDirty,
    [drafts, persistedDrafts, closingChanged, coords, persistedCoords, participantsDirty],
  )

  React.useEffect(() => {
    if (!enabled || !hydrated) return
    if (!unsent) {
      clearInspectionDraft(runId)
      setMirrorFailed(false)
      return
    }
    const input: InspectionDraftInput = {
      userId,
      version,
      drafts,
      closing: closingChanged
        ? { result: closing.result, restrictions: closing.restrictions ?? "", signatures: closing.signatures }
        : undefined,
      coords: coordsDiffer(coords, persistedCoords) ? coords : undefined,
      participants: participantsDirty && participantRows ? participantRows : undefined,
      base: persistedDrafts,
    }
    setMirrorFailed(!writeInspectionDraft(runId, input))
  }, [enabled, hydrated, unsent, runId, userId, version, drafts, closing, closingChanged, coords, persistedCoords, participantsDirty, participantRows, persistedDrafts])

  return { mirrorFailed, unsent }
}
