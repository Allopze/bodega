"use client"

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import { toast } from "@/lib/toast"
import { RE20_ATTACHMENT_ACCEPT_MESSAGE, RE20_ATTACHMENT_LIMITS } from "@/lib/prevention/re20-attachment-limits"
import { deleteRe20OfflineDraft, getRe20OfflineDraft, putRe20OfflineDraft } from "@/lib/prevention/re20-offline-drafts"
import { savePreventionIncidentRe20WorkspaceAction } from "../../actions"
import { re20StageDeadlines, type Re20Deadline } from "./deadlines"
import type {
  Re20Conflict,
  Re20Data,
  Re20LocalDraft,
  Re20OfflineAttachment,
  Re20Sensitive,
  Re20StageId,
  Re20Task,
  Re20WorkspaceProps,
} from "./types"
import {
  base64ToBytes,
  bytesToBase64,
  copyJson,
  isAllowedRe20MimeType,
  mergeWorkspaceDraft,
  newRe20Id,
  normalizeRe20Data,
  normalizeRe20Sensitive,
  re20TaskOf,
  setIn,
  sniffRe20MimeType,
  stableJson,
  withRe20TaskStatus,
  type Re20Path,
} from "./workspace-data"

/* ── Estado ──────────────────────────────────────────────────────────────── */

export type Re20SaveStatus = "saved" | "dirty" | "saving" | "error" | "offline" | "conflict"

export const RE20_STAGE_IDS: readonly Re20StageId[] = ["preliminar", "declaraciones", "diat", "investigacion", "calidad", "difusion", "seguimiento"]

export function isRe20StageId(value: unknown): value is Re20StageId {
  return typeof value === "string" && (RE20_STAGE_IDS as readonly string[]).includes(value)
}

/** La copia de ESTE expediente que se guarda sola en el equipo (cambios sin enviar). */
interface LocalCopyState {
  draftExists: boolean
  draftSavedAt: string | null
}

interface State {
  data: Re20Data
  base: Re20Data
  version: number
  sensitive: Re20Sensitive
  baseSensitive: Re20Sensitive
  sensitiveTouched: boolean
  sensitiveConflict: { local: Re20Sensitive; remote: Re20Sensitive } | null
  /** Había cambios reservados locales y el servidor cambió sin que se pudiera abrir su versión reservada. */
  sensitiveBaseConflict: boolean
  /** El borrador trae datos reservados que esta sesión no puede abrir. */
  localSensitivePending: boolean
  conflicts: Re20Conflict[]
  remoteData: Re20Data | null
  remoteVersion: number | null
  attachments: Re20OfflineAttachment[]
  extras: Record<string, unknown>
  saving: boolean
  error: string | null
  lastSavedAt: string | null
  stage: Re20StageId
  local: LocalCopyState
  /** Hay cambios que la copia local todavía no tiene. */
  localDirty: boolean
}

type Action =
  | { type: "update"; mutate: (data: Re20Data) => Re20Data }
  | { type: "updateSensitive"; mutate: (sensitive: Re20Sensitive) => Re20Sensitive }
  | { type: "setExtra"; key: string; value: unknown }
  | { type: "remote"; version: number; data: Re20Data; sensitive: Re20Sensitive | null; canSensitive: boolean }
  | { type: "restore"; payload: Re20LocalDraft; latestVersion: number; latestData: Re20Data; remoteSensitive: Re20Sensitive | null; canSensitive: boolean }
  | { type: "resolve"; section: string; choice: "local" | "remote" }
  | { type: "applyResolution"; fallbackVersion: number; fallbackData: Re20Data }
  | { type: "resolveSensitive"; choice: "local" | "remote" }
  | { type: "saveStart" }
  | { type: "saveSuccess"; version: number; sent: Re20Data; sentSensitive: boolean; at: string }
  | { type: "saveError"; message: string }
  | { type: "addAttachments"; items: Re20OfflineAttachment[] }
  | { type: "removeAttachment"; id: string }
  | { type: "attachmentsUploaded"; remaining: Re20OfflineAttachment[] }
  | { type: "local"; patch: Partial<LocalCopyState> }
  | { type: "localPersisted"; savedAt: string }
  /** Se retiró la copia local (el servidor ya tiene todo); `dirty` si hubo ediciones mientras se guardaba. */
  | { type: "localCleared"; dirty: boolean }
  | { type: "stage"; stage: Re20StageId }

function isDirty(state: Pick<State, "data" | "base" | "sensitiveTouched" | "attachments">) {
  return state.sensitiveTouched || state.attachments.length > 0 || stableJson(state.data) !== stableJson(state.base)
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "update":
      return { ...state, data: action.mutate(state.data), error: null, localDirty: true }
    case "updateSensitive":
      return { ...state, sensitive: action.mutate(state.sensitive), sensitiveTouched: true, error: null, localDirty: true }
    case "setExtra":
      return { ...state, extras: { ...state.extras, [action.key]: action.value }, localDirty: true }
    case "remote": {
      if (action.version <= state.version) return state
      const latest = action.data
      if (!isDirty(state)) {
        return {
          ...state,
          data: latest,
          base: latest,
          version: action.version,
          ...(action.sensitive ? { sensitive: action.sensitive, baseSensitive: action.sensitive } : {}),
        }
      }
      const merged = mergeWorkspaceDraft(state.base, state.data, latest)
      let next: State = {
        ...state,
        data: merged.merged as Re20Data,
        conflicts: merged.conflicts,
        remoteData: latest,
        remoteVersion: action.version,
        localDirty: true,
        ...(merged.conflicts.length === 0 ? { base: latest, version: action.version } : {}),
      }
      next = mergeSensitive(next, action.sensitive, action.canSensitive)
      return next
    }
    case "restore": {
      const { payload, latestVersion, latestData } = action
      const draftData = normalizeRe20Data(payload.data)
      const draftBase = normalizeRe20Data(payload.baseData)
      let next: State = {
        ...state,
        version: payload.baseVersion,
        base: draftBase,
        data: draftData,
        attachments: copyJson(payload.attachments ?? []),
        extras: { ...(payload.qualityCriteria ? { qualityCriteria: payload.qualityCriteria } : {}), ...(payload.extras ?? {}) },
        local: { draftExists: true, draftSavedAt: payload.savedAt },
      }
      if (payload.conflicts?.length) {
        next = {
          ...next,
          conflicts: copyJson(payload.conflicts),
          remoteData: payload.remoteData ? normalizeRe20Data(payload.remoteData) : latestData,
          remoteVersion: payload.remoteVersion ?? latestVersion,
        }
      } else if (latestVersion > payload.baseVersion) {
        const merged = mergeWorkspaceDraft(draftBase, draftData, latestData)
        next = {
          ...next,
          data: merged.merged as Re20Data,
          conflicts: merged.conflicts,
          remoteData: latestData,
          remoteVersion: latestVersion,
          localDirty: true,
          ...(merged.conflicts.length === 0 ? { version: latestVersion, base: latestData } : {}),
        }
      }
      if (payload.sensitive && action.canSensitive) {
        next = {
          ...next,
          sensitive: normalizeRe20Sensitive(payload.sensitive),
          sensitiveTouched: true,
          ...(payload.baseSensitive ? { baseSensitive: normalizeRe20Sensitive(payload.baseSensitive) } : {}),
        }
        if (payload.sensitiveConflict) next = { ...next, sensitiveConflict: copyJson(payload.sensitiveConflict) }
        else if (latestVersion > payload.baseVersion) next = mergeSensitive(next, action.remoteSensitive, true)
      } else if (payload.sensitive) {
        next = { ...next, localSensitivePending: true }
      }
      return next
    }
    case "resolve": {
      const conflict = state.conflicts.find((item) => item.section === action.section)
      if (!conflict) return state
      return {
        ...state,
        data: { ...state.data, [action.section]: copyJson(action.choice === "local" ? conflict.local : conflict.remote) } as Re20Data,
        conflicts: state.conflicts.map((item) => item.section === action.section ? { ...item, choice: action.choice } : item),
        localDirty: true,
      }
    }
    case "applyResolution":
      if (state.conflicts.some((item) => !item.choice)) return state
      return {
        ...state,
        version: state.remoteVersion ?? action.fallbackVersion,
        base: copyJson(state.remoteData ?? action.fallbackData),
        conflicts: [],
        remoteData: null,
        remoteVersion: null,
        localDirty: true,
      }
    case "resolveSensitive":
      if (!state.sensitiveConflict) return state
      return {
        ...state,
        sensitive: copyJson(action.choice === "local" ? state.sensitiveConflict.local : state.sensitiveConflict.remote),
        baseSensitive: copyJson(state.sensitiveConflict.remote),
        sensitiveTouched: action.choice === "local",
        sensitiveConflict: null,
        sensitiveBaseConflict: false,
        localDirty: true,
      }
    case "saveStart":
      return { ...state, saving: true, error: null }
    case "saveSuccess":
      return {
        ...state,
        saving: false,
        error: null,
        version: action.version,
        base: action.sent,
        lastSavedAt: action.at,
        ...(action.sentSensitive ? { baseSensitive: copyJson(state.sensitive), sensitiveTouched: false, sensitiveConflict: null, sensitiveBaseConflict: false } : {}),
      }
    case "saveError":
      return { ...state, saving: false, error: action.message }
    case "addAttachments":
      return {
        ...state,
        attachments: [...state.attachments, ...action.items],
        data: { ...state.data, attachmentIds: [...state.data.attachmentIds, ...action.items.map((item) => item.id)] },
        localDirty: true,
      }
    case "removeAttachment":
      return {
        ...state,
        attachments: state.attachments.filter((item) => item.id !== action.id),
        data: { ...state.data, attachmentIds: state.data.attachmentIds.filter((id) => id !== action.id) },
        localDirty: true,
      }
    case "attachmentsUploaded":
      return { ...state, attachments: action.remaining }
    case "local":
      return { ...state, local: { ...state.local, ...action.patch } }
    case "localPersisted":
      return { ...state, localDirty: false, local: { draftExists: true, draftSavedAt: action.savedAt } }
    case "localCleared":
      return { ...state, localDirty: action.dirty, local: { draftExists: false, draftSavedAt: null } }
    case "stage":
      return { ...state, stage: action.stage }
  }
}

/** La parte reservada sigue la misma regla de tres vías, pero como un solo bloque. */
function mergeSensitive(state: State, remote: Re20Sensitive | null, canSensitive: boolean): State {
  if (!state.sensitiveTouched) return remote ? { ...state, baseSensitive: remote } : state
  if (!remote || !canSensitive) return { ...state, sensitiveBaseConflict: true }
  const localChanged = stableJson(state.sensitive) !== stableJson(state.baseSensitive)
  const remoteChanged = stableJson(remote) !== stableJson(state.baseSensitive)
  if (localChanged && remoteChanged && stableJson(state.sensitive) !== stableJson(remote)) {
    return { ...state, sensitiveConflict: { local: copyJson(state.sensitive), remote: copyJson(remote) }, baseSensitive: remote }
  }
  if (!localChanged) return { ...state, sensitive: remote, baseSensitive: remote, sensitiveTouched: false }
  return { ...state, baseSensitive: remote }
}

/* ── Conexión ────────────────────────────────────────────────────────────── */

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback)
  window.addEventListener("offline", callback)
  return () => {
    window.removeEventListener("online", callback)
    window.removeEventListener("offline", callback)
  }
}

/* ── Foco en un campo (faltantes, errores) ───────────────────────────────── */

/**
 * Lleva el pozo hasta el campo `fieldId` y lo enfoca. Abre el bloque plegable
 * que lo contiene. Si el nodo no es enfocable (un grupo Sí/No), enfoca su
 * primer control. Reintenta unos cuadros: al cambiar de etapa el campo aparece
 * después del render.
 */
export function focusRe20Field(fieldId: string, frames = 30) {
  const tick = (left: number) => {
    const target = document.getElementById(fieldId)
    if (target) {
      let parent = target.parentElement
      while (parent) {
        if (parent instanceof HTMLDetailsElement && !parent.open) parent.open = true
        parent = parent.parentElement
      }
      const focusable = target.matches("input, select, textarea, button, [tabindex]")
        ? target
        : target.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea, button, [tabindex]")
      target.scrollIntoView?.({ block: "center" })
      ;(focusable ?? target).focus({ preventScroll: true })
      return
    }
    if (left > 0) requestAnimationFrame(() => tick(left - 1))
  }
  requestAnimationFrame(() => tick(frames))
}

/* ── Hook ────────────────────────────────────────────────────────────────── */

export interface Re20PendingAttachment {
  id: string
  fileName: string
  mimeType: string
  size: number
}

export type Re20ActionResult = { ok: boolean; message?: string }

function initialState(props: Re20WorkspaceProps): State {
  const { workspace, initialLocalDraft, sensitivePayload, incident, initialStage } = props
  const serverData = normalizeRe20Data(workspace?.data ?? {})
  const sensitive = normalizeRe20Sensitive(initialLocalDraft?.sensitive ?? sensitivePayload, incident.knownAt)
  const baseSensitive = normalizeRe20Sensitive(sensitivePayload, incident.knownAt)
  const state: State = {
    data: serverData,
    base: serverData,
    version: workspace?.version ?? 0,
    sensitive,
    baseSensitive,
    sensitiveTouched: false,
    sensitiveConflict: null,
    sensitiveBaseConflict: false,
    localSensitivePending: false,
    conflicts: [],
    remoteData: null,
    remoteVersion: null,
    attachments: [],
    extras: {},
    saving: false,
    error: null,
    lastSavedAt: null,
    stage: isRe20StageId(initialStage) ? initialStage : "preliminar",
    local: { draftExists: Boolean(initialLocalDraft), draftSavedAt: initialLocalDraft?.savedAt ?? null },
    localDirty: false,
  }
  if (!initialLocalDraft) return state
  return reducer(state, {
    type: "restore",
    payload: initialLocalDraft,
    latestVersion: workspace?.version ?? 0,
    latestData: serverData,
    remoteSensitive: sensitivePayload ? normalizeRe20Sensitive(sensitivePayload, incident.knownAt) : null,
    canSensitive: props.permissions.canSensitive,
  })
}

const EMPTY_FOLLOWUPS: NonNullable<Re20WorkspaceProps["followups"]> = []
const EMPTY_ONE_PAGES: NonNullable<Re20WorkspaceProps["onePageDiffusions"]> = []

export function useRe20Workspace(props: Re20WorkspaceProps) {
  const {
    incident, workspace, policy, options, qualityReviews, sensitivePayload, permissions, currentUser,
    userId, people, involvedPeople, diffusions, notifications, capa, legacyInvestigation, initialPurpose,
    offlineOnly = false, sensitiveLoadError, followups = EMPTY_FOLLOWUPS, onePageDiffusions = EMPTY_ONE_PAGES, renderedAt,
  } = props
  const [now, setNow] = useState(() => (renderedAt ? Date.parse(renderedAt) : Date.now()))
  useEffect(() => {
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const router = useRouter()
  const [state, dispatch] = useReducer(reducer, props, initialState)
  // Las funciones asíncronas (guardar, copia local) leen el estado vigente, no el de su render.
  const stateRef = useRef(state)
  useLayoutEffect(() => { stateRef.current = state })
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true)
  const localDraftId = `incident-workspace:${incident.id}`
  const purpose = initialPurpose.trim()
  const readOnly = !permissions.canInvestigate || incident.status === "closed"
  const sensitiveAvailable = permissions.canSensitive && (sensitivePayload !== null || offlineOnly)
  const dirty = isDirty(state)
  const hasConflicts = state.conflicts.length > 0 || state.sensitiveConflict !== null || state.sensitiveBaseConflict

  /* El servidor trae una versión nueva (otra persona guardó): fusión de tres vías. */
  useEffect(() => {
    if (!workspace || workspace.version <= stateRef.current.version) return
    dispatch({
      type: "remote",
      version: workspace.version,
      data: normalizeRe20Data(workspace.data),
      sensitive: sensitivePayload ? normalizeRe20Sensitive(sensitivePayload, incident.knownAt) : null,
      canSensitive: permissions.canSensitive,
    })
  // La versión del servidor es el disparador; el resto se compara contra la base guardada.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.version])

  function restore(payload: Re20LocalDraft) {
    if (payload.incidentId !== incident.id) return
    dispatch({
      type: "restore",
      payload,
      latestVersion: workspace?.version ?? 0,
      latestData: normalizeRe20Data(workspace?.data ?? {}),
      remoteSensitive: sensitivePayload ? normalizeRe20Sensitive(sensitivePayload, incident.knownAt) : null,
      canSensitive: permissions.canSensitive,
    })
  }

  /* Copia local de este expediente: si quedaron cambios sin enviar, se recuperan al abrirlo. */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const draft = await getRe20OfflineDraft<Re20LocalDraft>(userId, localDraftId)
      if (cancelled) return
      dispatch({ type: "local", patch: { draftExists: Boolean(draft), draftSavedAt: draft?.payload.savedAt ?? null } })
      if (!draft || draft.kind !== "incident_workspace" || props.initialLocalDraft || incident.status === "closed" || draft.payload.incidentId !== incident.id) return
      restore(draft.payload)
      const { data, baseData, sensitive, attachments } = draft.payload
      if (stableJson(data) !== stableJson(baseData) || sensitive || (attachments?.length ?? 0) > 0) {
        toast.info("Recuperamos los cambios de este equipo que no se habían enviado. Revísalos y guarda.")
      }
    })().catch(() => {})
    return () => { cancelled = true }
  // Se restaura una vez por expediente al montar.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, localDraftId])

  const persistLocalDraft = useCallback(async (overrides: { version?: number; base?: Re20Data; data?: Re20Data; attachments?: Re20OfflineAttachment[] } = {}) => {
    const current = stateRef.current
    if (current.localSensitivePending) throw new Error("Este borrador trae datos reservados: sólo una persona con acceso reservado puede abrirlo o sincronizarlo.")
    const savedAt = new Date().toISOString()
    const payload: Re20LocalDraft = {
      incidentId: incident.id,
      baseVersion: overrides.version ?? current.version,
      baseData: copyJson(overrides.base ?? current.base) as Record<string, unknown>,
      data: copyJson(overrides.data ?? current.data) as Record<string, unknown>,
      // Lo reservado (declaraciones, entrevista, detalle clínico, DIAT) y los anexos NO se guardan
      // en el equipo: el borrador local va en claro y la pantalla pública sin conexión lo lee sin
      // sesión. Viven sólo en memoria y se envían con conexión y propósito auditado.
      conflicts: copyJson(current.conflicts),
      attachments: [],
      ...(current.remoteData ? { remoteData: copyJson(current.remoteData) as Record<string, unknown>, remoteVersion: current.remoteVersion ?? undefined } : {}),
      extras: copyJson(current.extras),
      context: {
        incident, policy, options, qualityReviews, legacyInvestigation, diffusions, notifications, capa, currentUser, people, involvedPeople,
        canSensitive: permissions.canSensitive,
        canNotify: permissions.canNotify,
        canReview: permissions.canReview,
        canConfirmDiffusion: permissions.canConfirmDiffusion,
      },
      savedAt,
    }
    await putRe20OfflineDraft(userId, { id: localDraftId, kind: "incident_workspace", payload, attempts: 0 })
    const verified = await getRe20OfflineDraft<Re20LocalDraft>(userId, localDraftId)
    if (!verified || verified.payload.incidentId !== incident.id || verified.payload.savedAt !== savedAt) {
      throw new Error("No se pudo comprobar la copia guardada en este equipo. Deja esta pantalla abierta e inténtalo de nuevo.")
    }
    dispatch({ type: "localPersisted", savedAt })
  }, [incident, policy, options, qualityReviews, legacyInvestigation, diffusions, notifications, capa, currentUser, people, involvedPeople, permissions, userId, localDraftId])

  /* Copia local automática: todo cambio sin enviar queda guardado en este equipo (sin frase, sin pantalla). */
  useEffect(() => {
    if (!state.localDirty || state.localSensitivePending) return
    const timer = setTimeout(() => {
      void persistLocalDraft().catch((error) => {
        // Con conexión la copia es sólo una red de seguridad: sin almacenamiento local no se molesta a nadie.
        if (!navigator.onLine || offlineOnly) toast.error(error instanceof Error ? error.message : "No se pudo guardar tu trabajo en este equipo.")
      })
    }, 700)
    return () => clearTimeout(timer)
  }, [state.data, state.sensitive, state.extras, state.conflicts, state.attachments, state.localDirty, state.localSensitivePending, persistLocalDraft, offlineOnly])

  /* Salir con cambios que no están ni en el servidor ni guardados en este equipo. */
  useEffect(() => {
    if (!dirty || readOnly) return
    const warn = (event: BeforeUnloadEvent) => {
      if (stateRef.current.local.draftExists && !stateRef.current.localDirty) return
      event.preventDefault()
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty, readOnly])

  /* Vuelve la señal con cambios sin enviar: se avisa; guardar (con la elección de conflictos y el propósito de los datos reservados) sigue siendo de la persona. */
  const wasOnline = useRef(online)
  useEffect(() => {
    const returned = online && !wasOnline.current
    wasOnline.current = online
    if (returned && !offlineOnly && !readOnly && isDirty(stateRef.current)) {
      toast.info("Volvió la conexión. Guarda el expediente para enviar tus cambios.")
    }
  }, [online, offlineOnly, readOnly])

  async function uploadAttachment(attachment: Re20OfflineAttachment, expectedWorkspaceVersion: number) {
    const form = new FormData()
    form.set("clientAttachmentId", attachment.id)
    form.set("expectedWorkspaceVersion", String(expectedWorkspaceVersion))
    form.set("purpose", purpose)
    form.set("file", new File([base64ToBytes(attachment.contentBase64) as BlobPart], attachment.fileName, { type: attachment.mimeType }))
    const response = await fetch(`/api/prevencion/incidentes/${incident.id}/re20/attachments`, { method: "POST", body: form })
    const result = await response.json().catch(() => null) as { ok?: boolean; message?: string } | null
    if (!response.ok || !result?.ok) throw new Error(result?.message ?? `No se pudo subir «${attachment.fileName}».`)
  }

  /**
   * Guarda en el servidor. Devuelve la versión guardada, o `null` si no se pudo
   * (ya avisó por qué). `apply` aplica un último cambio y lo guarda en el mismo
   * paso (p. ej. marcar la tarea de la etapa como terminada): un `patch` seguido
   * de `save()` guardaría el estado anterior, porque el render aún no ocurrió.
   */
  async function save(apply?: (data: Re20Data) => Re20Data): Promise<number | null> {
    let current = stateRef.current
    if (readOnly || current.saving) return null
    if (apply) {
      const nextData = apply(current.data)
      dispatch({ type: "update", mutate: () => nextData })
      current = { ...current, data: nextData }
      stateRef.current = current
    }
    if (!offlineOnly && (current.conflicts.some((item) => !item.choice) || current.sensitiveConflict || current.sensitiveBaseConflict)) {
      toast.error("Antes de guardar, elige qué versión conservar en cada diferencia con lo que guardó otra persona.")
      return null
    }
    if (current.localSensitivePending) {
      toast.error("Este borrador trae datos reservados. Queda en este equipo hasta que lo abra una persona con acceso reservado.")
      return null
    }
    if (offlineOnly || !online) {
      try {
        await persistLocalDraft()
        toast.success("Guardado en este equipo. Para enviarlo, abre el caso con conexión y guarda.")
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo guardar tu trabajo en este equipo.")
      }
      return null
    }
    if (current.sensitiveTouched && (!sensitiveAvailable || purpose.length < 3)) {
      toast.error("Para guardar datos reservados, ábrelos primero indicando para qué los necesitas.")
      return null
    }
    dispatch({ type: "saveStart" })
    const sent = copyJson(current.data)
    const sentSensitive = current.sensitiveTouched
    try {
      // Los anexos pesan: se aseguran en este equipo antes de enviar, por si se corta la señal a mitad.
      if (current.attachments.length > 0) await persistLocalDraft().catch(() => {})
      const result = await savePreventionIncidentRe20WorkspaceAction({
        incidentId: incident.id,
        expectedVersion: current.version,
        mutationId: newRe20Id("re20-save"),
        data: sent,
        ...(sentSensitive ? { sensitive: { ...current.sensitive, purpose } } : {}),
      })
      if (!result.ok) {
        const message = result.message ?? "No se pudo guardar el expediente."
        dispatch({ type: "saveError", message })
        toast.error(message)
        // Otra persona guardó antes: se trae su versión y la fusión muestra las diferencias.
        if (/modificó|cambió|recarga|versión/i.test(message)) router.refresh()
        return null
      }
      const nextVersion = result.version ?? current.version + 1
      dispatch({ type: "saveSuccess", version: nextVersion, sent, sentSensitive, at: new Date().toISOString() })
      let remaining = [...stateRef.current.attachments]
      for (const attachment of current.attachments.filter((item) => sent.attachmentIds.includes(item.id))) {
        try {
          await uploadAttachment(attachment, nextVersion)
          remaining = remaining.filter((item) => item.id !== attachment.id)
          dispatch({ type: "attachmentsUploaded", remaining })
        } catch (error) {
          await persistLocalDraft({ version: nextVersion, base: sent, attachments: remaining }).catch(() => {})
          toast.warning(`${error instanceof Error ? error.message : "Un anexo no se pudo subir."} El expediente sí quedó guardado; vuelve a guardar para reintentar el anexo.`)
          return nextVersion
        }
      }
      // El servidor ya lo tiene: la copia de este equipo sobra, salvo anexos por subir o lo escrito mientras se guardaba.
      if (remaining.length > 0) {
        await persistLocalDraft({ version: nextVersion, base: sent, attachments: remaining }).catch(() => {})
      } else {
        const latest = stateRef.current
        const editedDuringSave = stableJson(latest.data) !== stableJson(sent)
          || (sentSensitive ? stableJson(latest.sensitive) !== stableJson(current.sensitive) : latest.sensitiveTouched)
        await deleteRe20OfflineDraft(userId, localDraftId).catch(() => {})
        dispatch({ type: "localCleared", dirty: editedDuringSave })
      }
      toast.success(result.message ?? "Expediente guardado")
      return nextVersion
    } catch (error) {
      const failure = error instanceof Error ? error.message : ""
      if (!navigator.onLine || /failed to fetch|networkerror|network request failed|load failed/i.test(failure)) {
        await persistLocalDraft().catch(() => {})
        const lost = "Se cortó la conexión. Los cambios quedaron guardados en este equipo."
        dispatch({ type: "saveError", message: lost })
        toast.warning(lost)
        return null
      }
      const message = failure || "No se pudo guardar el expediente."
      dispatch({ type: "saveError", message })
      toast.error(message)
      return null
    }
  }

  /** La versión del servidor con todo lo de esta pantalla ya guardado (guarda si hace falta). */
  async function ensureSaved(): Promise<number | null> {
    return isDirty(stateRef.current) ? save() : stateRef.current.version
  }

  /**
   * Ejecuta una acción del servidor que depende del expediente guardado
   * (crear CAPA, registrar revisión, publicar difusión…). Guarda antes si hay
   * cambios, pasa la versión vigente y avisa el resultado. La acción ya
   * revalida la página: aquí NO se repite `router.refresh()`.
   */
  async function runServerAction<T extends Re20ActionResult>(
    run: (version: number) => Promise<T>,
    options: { requireSaved?: boolean; successMessage?: string } = {},
  ): Promise<T | null> {
    if (offlineOnly || !online) {
      toast.info("Esta acción necesita conexión. Tus cambios siguen en esta pantalla.")
      return null
    }
    const version = options.requireSaved === false ? stateRef.current.version : await ensureSaved()
    if (version === null) return null
    try {
      const result = await run(version)
      if (result.ok) toast.success(options.successMessage ?? result.message ?? "Listo")
      else toast.error(result.message ?? "No se pudo completar la acción.")
      return result
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo completar la acción.")
      return null
    }
  }

  async function addAttachments(files: FileList | File[] | null): Promise<Re20PendingAttachment[]> {
    const list = Array.from(files ?? [])
    if (list.length === 0 || readOnly) return []
    if (!permissions.canSensitive || (!offlineOnly && purpose.length < 3)) {
      toast.error("Los anexos son datos reservados: ábrelos primero indicando para qué los necesitas.")
      return []
    }
    const current = stateRef.current
    const { maxFileBytes, maxTotalBytes, maxCount } = RE20_ATTACHMENT_LIMITS
    if (current.data.attachmentIds.length + list.length > maxCount) {
      toast.error(`El expediente admite hasta ${maxCount} anexos.`)
      return []
    }
    const queued = current.attachments.reduce((total, item) => total + item.size, 0)
    if (queued + list.reduce((total, file) => total + file.size, 0) > maxTotalBytes) {
      toast.error(`Los anexos por enviar no pueden superar ${maxTotalBytes / (1024 * 1024)} MB en total. Guarda primero los que ya agregaste.`)
      return []
    }
    const items: Re20OfflineAttachment[] = []
    for (const file of list) {
      if (file.size < 1 || file.size > maxFileBytes) {
        toast.error(`«${file.name}» pesa más de ${maxFileBytes / (1024 * 1024)} MB o está vacío. ${RE20_ATTACHMENT_ACCEPT_MESSAGE}`)
        return []
      }
      let bytes: Uint8Array
      try {
        bytes = new Uint8Array(await file.arrayBuffer())
      } catch {
        toast.error(`No se pudo leer «${file.name}». Conserva el archivo original e inténtalo de nuevo.`)
        return []
      }
      // El tipo se toma del contenido: el servidor lo comprueba igual y rechaza si no calza.
      const mimeType = sniffRe20MimeType(bytes)
      if (!isAllowedRe20MimeType(mimeType)) {
        toast.error(`«${file.name}» no es un archivo admitido. ${RE20_ATTACHMENT_ACCEPT_MESSAGE}`)
        return []
      }
      items.push({ id: newRe20Id("attachment"), fileName: file.name, mimeType, size: file.size, contentBase64: bytesToBase64(bytes) })
    }
    dispatch({ type: "addAttachments", items })
    return items.map(({ id, fileName, mimeType, size }) => ({ id, fileName, mimeType, size }))
  }

  /**
   * Abre una etapa: queda en la URL (`?etapa=`, con `replaceState`: estado de la
   * vista, sin historial ni ida al servidor) y el foco va a su título o al campo
   * indicado. `quiet` sólo cambia la etapa (la elección inicial, sin mover el foco).
   */
  function setStage(stage: Re20StageId, options: { focusFieldId?: string; quiet?: boolean } = {}) {
    dispatch({ type: "stage", stage })
    if (options.quiet) return
    if (!offlineOnly) {
      const url = new URL(window.location.href)
      url.searchParams.set("etapa", stage)
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
    }
    if (options.focusFieldId) focusRe20Field(options.focusFieldId)
    else focusRe20Field(`re20-stage-${stage}-title`, 10)
  }

  const deadlines = useMemo(
    () => re20StageDeadlines({ incident, data: state.data, policy, qualityReviews }),
    [incident, state.data, policy, qualityReviews],
  )

  const status: Re20SaveStatus = state.saving ? "saving"
    : hasConflicts ? "conflict"
      : !online || offlineOnly ? "offline"
        : state.error ? "error"
          : dirty ? "dirty" : "saved"

  const pendingAttachments: Re20PendingAttachment[] = state.attachments.map(({ id, fileName, mimeType, size }) => ({ id, fileName, mimeType, size }))

  return {
    /* Contexto del caso (sólo lectura). */
    incident, policy, options, people, involvedPeople, qualityReviews, diffusions, notifications, capa, legacyInvestigation,
    currentUser, permissions, offlineOnly, online, readOnly, followups, onePageDiffusions,
    /** Reloj de los plazos: igual al del servidor en la hidratación, luego avanza cada minuto. */
    now,
    deadlines: deadlines as Partial<Record<Re20StageId, Re20Deadline>>,

    /* Datos y edición. */
    data: state.data,
    sensitive: state.sensitive,
    /** Los datos reservados están abiertos (permiso + propósito) y se pueden editar. */
    sensitiveAvailable,
    sensitiveLoadError,
    purpose,
    version: state.version,
    /** `patch("preliminary.temperature", "Lluvia")` o `patch(["measures", 0, "dueAt"], iso)`. */
    patch: (path: Re20Path, value: unknown) => dispatch({ type: "update", mutate: (data) => setIn(data, path, value) }),
    update: (mutate: (data: Re20Data) => Re20Data) => dispatch({ type: "update", mutate }),
    patchSensitive: (path: Re20Path, value: unknown) => dispatch({ type: "updateSensitive", mutate: (sensitive) => setIn(sensitive, path, value) }),
    updateSensitive: (mutate: (sensitive: Re20Sensitive) => Re20Sensitive) => dispatch({ type: "updateSensitive", mutate }),
    task: (taskId: string): Re20Task => re20TaskOf(state.data, taskId),
    setTaskStatus: (taskId: string, taskStatus: Re20Task["status"]) => dispatch({ type: "update", mutate: (data) => withRe20TaskStatus(data, taskId, taskStatus) }),
    /** Borradores de etapa que no son parte de `data` (p. ej. la revisión de calidad sin enviar); viajan en la copia local del equipo. */
    extras: state.extras,
    setExtra: (key: string, value: unknown) => dispatch({ type: "setExtra", key, value }),

    /* Guardado. */
    status,
    dirty,
    saving: state.saving,
    errorMessage: state.error,
    lastSavedAt: state.lastSavedAt,
    save,
    ensureSaved,
    runServerAction,

    /* Conflictos con otra versión guardada. */
    conflicts: state.conflicts,
    remoteUpdatedByName: workspace?.updatedByName ?? null,
    remoteUpdatedAt: workspace?.updatedAt ?? null,
    sensitiveConflict: state.sensitiveConflict,
    sensitiveBaseConflict: state.sensitiveBaseConflict,
    localSensitivePending: state.localSensitivePending,
    resolveConflict: (section: string, choice: "local" | "remote") => dispatch({ type: "resolve", section, choice }),
    applyConflictResolution: () => dispatch({ type: "applyResolution", fallbackVersion: workspace?.version ?? state.version, fallbackData: normalizeRe20Data(workspace?.data ?? {}) }),
    resolveSensitiveConflict: (choice: "local" | "remote") => dispatch({ type: "resolveSensitive", choice }),

    /* Anexos: se validan aquí (tipo real y tamaño) y se suben al guardar. */
    pendingAttachments,
    /** Hay datos reservados o anexos sin enviar: no se guardan en el equipo, sólo en memoria. */
    reservedUnsaved: state.sensitiveTouched || state.attachments.length > 0,
    addAttachments,
    removeAttachment: (id: string) => dispatch({ type: "removeAttachment", id }),
    attachmentHref: (id: string) => (sensitiveAvailable && purpose.length >= 3 && !offlineOnly && !state.attachments.some((item) => item.id === id)
      ? `/api/prevencion/incidentes/${incident.id}/re20/attachments/${encodeURIComponent(id)}?purpose=${encodeURIComponent(purpose)}`
      : null),

    /* Navegación entre etapas (`?etapa=`). */
    stage: state.stage,
    setStage,
    /** Abre la etapa (si se indica) y lleva el foco al campo con ese id. */
    focusField: (fieldId: string, stage?: Re20StageId) => {
      if (stage && stage !== stateRef.current.stage) setStage(stage, { focusFieldId: fieldId })
      else focusRe20Field(fieldId)
    },
  }
}

export type Re20WorkspaceApi = ReturnType<typeof useRe20Workspace>

export const Re20WorkspaceContext = createContext<Re20WorkspaceApi | null>(null)

/** El expediente desde cualquier componente dentro de `Re20WorkspaceShell`. */
export function useRe20(): Re20WorkspaceApi {
  const value = useContext(Re20WorkspaceContext)
  if (!value) throw new Error("useRe20 debe usarse dentro de Re20WorkspaceShell.")
  return value
}
