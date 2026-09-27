"use client"

import * as React from "react"
import Link from "next/link"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  assessRunCompletion,
  criticalityBadgeVariant,
  effectiveRequiredItems,
  FINDING_CRITICALITY_LABELS,
  FINDING_STATUS_LABELS,
  INSPECTION_KIND_LABELS,
  INSPECTION_ORIGIN_LABELS,
  fieldKindIsScorable,
  inspectionResultLabel,
  inspectionResultOptionsFor,
  formatSignatureRole,
  resultBadgeVariant,
  resultSelectToneClass,
  runStatusBadgeVariant,
  summarizeCompliance,
  validateAnswerRow,
  type ClosingActInput,
  type ClosingActSpec,
  type InspectionAnswerInput,
  type InspectionItemSpec,
} from "@/lib/prevention/inspections"
import type { ChecklistDefinition } from "@/lib/sst/types"
import { formatDate, formatDateTime } from "@/lib/utils"
import {
  cancelInspectionRunAction,
  closeInspectionFindingAction,
  completeInspectionRunAction,
  reopenInspectionRunAction,
  saveInspectionAnswersAction,
} from "../actions"
import { Field } from "@/components/ui/field"
import { useOperation } from "@/lib/hooks/use-operation"
import { autosaveStatusLabel, useDebouncedAutosave } from "@/lib/hooks/use-debounced-autosave"
import {
  clearInspectionDraft,
  readInspectionDraft,
  writeInspectionDraft,
} from "@/lib/prevention/inspection-draft-storage"
import { inspectionSubjectTypeLabel, inspectionTaskStatusLabel } from "@/lib/prevention/inspection-list-query"
import type { OfflineInspectionSubmission } from "./offline-inspection-queue"
import type {
  RunInfo,
  SectionInfo,
  AnswerInfo,
  FindingInfo,
  ResultValue,
  Draft,
  RunDocumentInfo,
} from "./_components/types"
import { RemindReviewButton, ReasonDialog, NonScorableField } from "./_components/run-detail-controls"
import { AnswerEvidence } from "./_components/inspection-evidence"
import { PreventiveActionsPanel, ParticipantsPanel, DeviationsPanel } from "./_components/deviation-panels"
import { CompleteDialog } from "./_components/complete-dialog"
import { CapaDialog, StopVehicleDialog } from "./_components/finding-dialogs"
import { SourceFormViewer, SourceFormUpload } from "./_components/source-form"
import { ReviewDialog } from "./_components/review-dialog"

export { AnswerEvidence } from "./_components/inspection-evidence"
export type { RunDocumentInfo } from "./_components/types"

interface Props {
  run: RunInfo
  templateKind: string
  /** El instrumento registra desviaciones en vez de puntuar ítems. */
  recordsDeviations: boolean
  recordsPreventiveActions: boolean
  /** Catálogo activo del instrumento: de acá sale la gravedad de cada desviación. */
  deviationCatalog: { id: string; label: string; danoPotencial: string; criticality: string }[]
  /** Actividades del programa anual que esta inspección acredita al ejecutarse. */
  pdtpActivityNumbers: number[]
  /** Y las que acredita al revisarse y firmarse: son otra ocurrencia y otro responsable. */
  pdtpReviewActivityNumbers: number[]
  worksiteName: string
  assigneeName: string | null
  executorName: string | null
  reviewerName: string | null
  sections: SectionInfo[]
  answers: AnswerInfo[]
  findings: FindingInfo[]
  isUnplannedInspection: boolean
  participants: { id: string; name: string; position: string; userId: string | null }[]
  currentUserId: string
  assignees: { id: string; name: string }[]
  /** I-08: quién puede cerrarla en esta faena; se resuelve sólo cuando el bloqueo aplica. */
  reviewers: { id: string; name: string }[]
  canExecute: boolean
  canReview: boolean
  canManage: boolean
  canRequestRecharge: boolean
  /** `combustibles:manage_vehicles`: confirma sacar el equipo de servicio. */
  canStopVehicle: boolean
  /** Planillas físicas adjuntas al run. */
  documents: RunDocumentInfo[]
  /** `prevention:inspections:ingest`: sube la foto de la planilla. */
  canIngest: boolean
  /** Acta que declara la plantilla; `null` si no exige uno. */
  closingAct: ClosingActSpec | null
  scoringPolicy?: ChecklistDefinition["scoringPolicy"]
  /** Reporte de Equipos: el papel es el insumo que el jefe de faena transcribe. */
  physicalSourceRequired: boolean
}

function draftKey(sectionId: string, itemId: string) {
  return `${sectionId}::${itemId}`
}

/**
 * I-06: el árbol móvil y el de escritorio coexisten en el DOM —uno oculto por
 * `md:hidden`/`hidden md:*`—, así que sólo uno está realmente visible. Se
 * prueba primero el id móvil y se usa `offsetParent` (null si el elemento o un
 * ancestro tiene `display:none`) para devolver el que esté pintado.
 */
function visibleItemElement(key: string): HTMLElement | null {
  for (const prefix of ["item-mobile-", "item-desktop-"]) {
    const el = document.getElementById(`${prefix}${key}`)
    if (el && el.offsetParent !== null) return el
  }
  return null
}

/** Salta al ítem y enfoca su primer control, para dejar a la persona lista para responder. */
function jumpToItem(key: string) {
  const el = visibleItemElement(key)
  if (!el) return
  el.scrollIntoView({ behavior: "smooth", block: "center" })
  el.querySelector<HTMLElement>("button, select, input, textarea, [tabindex]")?.focus()
}

/**
 * I-19: el chip de navegación anteponía "{index+1}. " sobre `section.title`,
 * y una parte del catálogo SST ya numera sus secciones en el propio título
 * ("1. Documentos") mientras otra parte no ("Observaciones generales") — no
 * es consistente, así que no basta con quitar el prefijo siempre: sólo se
 * omite cuando el título ya empieza con un número.
 */
const SECTION_TITLE_ALREADY_NUMBERED = /^\d+\.\s/
function sectionNavLabel(title: string, index: number) {
  return SECTION_TITLE_ALREADY_NUMBERED.test(title) ? title : `${index + 1}. ${title}`
}

export function InspectionRunDetail({
  run, templateKind, recordsDeviations, recordsPreventiveActions, deviationCatalog,
  pdtpActivityNumbers, pdtpReviewActivityNumbers,
  worksiteName, assigneeName, executorName, reviewerName,
  sections, answers, findings, isUnplannedInspection, participants, currentUserId, assignees, reviewers, canExecute, canReview, canManage, canStopVehicle, canRequestRecharge,
  documents, canIngest, closingAct,
  scoringPolicy,
  physicalSourceRequired,
}: Props) {
  const editable = canExecute && ["planned", "in_progress"].includes(run.status)
  const items: InspectionItemSpec[] = React.useMemo(
    () => sections.flatMap((section) => section.items.map((item) => ({ ...item, sectionId: section.id, itemId: item.id }))),
    [sections],
  )

  const [drafts, setDrafts] = React.useState<Record<string, Draft>>(() => {
    const initial: Record<string, Draft> = {}
    for (const answer of answers) {
      initial[draftKey(answer.sectionId, answer.itemId)] = {
        result: answer.result as ResultValue,
        comment: answer.comment ?? "",
        value: answer.value ?? "",
        needsConfirmation: answer.needsConfirmation ?? false,
      }
    }
    return initial
  })
  const operation = useOperation()
  /* INS-02: el hook de autoguardado vigila un primitivo por valor, así que un
   * contador que sube en cada edición cumple sin serializar el mapa completo en
   * cada render. Mismo patrón que `use-checklist-responses.ts` en el motor SST. */
  const [revision, setRevision] = React.useState(0)
  /* Hasta qué revisión llegó lo ya persistido. Sin esto `isDirty` era
   * `revision > 0`, que después de la primera edición nunca vuelve a ser falso:
   * el rótulo decía "Cambios sin guardar" justo después de guardar y el
   * `beforeunload` del hook retenía cada salida del navegador con todo ya
   * persistido. */
  const [savedRevision, setSavedRevision] = React.useState(0)
  /* La revisión que viajó en el envío en vuelo. `answersPayload()` se congela al
   * llamar a la acción, así que lo persistido es esa revisión y no la que haya
   * cuando llegue la respuesta: editar durante el envío debe dejar el formulario
   * sucio, no darlo por guardado. */
  const revisionInFlight = React.useRef(0)
  const [restoredDraft, setRestoredDraft] = React.useState(false)

  /* Espejo local recuperado. Sólo se aplica si es MÁS nuevo que lo que trae el
   * servidor (misma versión del run): si alguien guardó desde otra sesión, lo
   * persistido manda y el espejo se descarta, o restaurar pisaría trabajo ajeno
   * con un borrador viejo del dispositivo. */
  React.useEffect(() => {
    if (!editable) return
    const snapshot = readInspectionDraft(run.id)
    if (!snapshot || snapshot.version !== run.version) {
      if (snapshot) clearInspectionDraft(run.id)
      return
    }
    setDrafts((current) => {
      const restored = { ...current }
      for (const [key, draft] of Object.entries(snapshot.drafts)) {
        restored[key] = {
          result: draft.result as ResultValue,
          comment: draft.comment ?? "",
          value: draft.value ?? "",
          needsConfirmation: draft.needsConfirmation ?? false,
        }
      }
      return restored
    })
    setRestoredDraft(true)
    // Sólo al montar: después manda lo que la persona esté tecleando.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id])

  // C-02: el guardado ahora sube `version`, así que el CAS del siguiente envío
  // debe usar la que devolvió el servidor y no la de las props, que quedó
  // obsoleta en cuanto se guardó una vez.
  const [version, setVersion] = React.useState(run.version)
  React.useEffect(() => { setVersion(run.version) }, [run.version])

  // Función faltante #8: `locationLatitude/Longitude` ya se aceptaban en el
  // servicio y ninguna pantalla los enviaba nunca.
  // Función #2: el acta que la plantilla declara y nadie podía llenar.
  const [closing, setClosing] = React.useState<ClosingActInput>(() => ({
    result: run.closingResult ?? "",
    restrictions: run.closingRestrictions ?? "",
    signatures: (closingAct?.signatureRoles ?? []).map((role) => ({
      role,
      name: run.closingSignatures?.find((item) => item.role === role)?.name ?? "",
      userId: run.closingSignatures?.find((item) => item.role === role)?.userId ?? null,
    })),
  }))

  const [coords, setCoords] = React.useState<{ lat: string; lon: string } | null>(() =>
    run.locationLatitude && run.locationLongitude ? { lat: run.locationLatitude, lon: run.locationLongitude } : null,
  )
  React.useEffect(() => {
    if (run.locationLatitude && run.locationLongitude) setCoords({ lat: run.locationLatitude, lon: run.locationLongitude })
  }, [run.locationLatitude, run.locationLongitude])
  const [geoState, setGeoState] = React.useState<"idle" | "pending" | "denied">("idle")

  // Función #9: la idempotencia del servidor (`clientSubmissionId`, su índice
  // único y el retorno `alreadyCompleted`) ya existía; faltaba el cliente.
  const [queued, setQueued] = React.useState(0)
  const [offlineNote, setOfflineNote] = React.useState("")

  const refreshQueue = React.useCallback(async () => {
    const { listQueuedInspectionSubmissions } = await import("./offline-inspection-queue")
    const entries = await listQueuedInspectionSubmissions()
    setQueued(entries.filter((entry) => entry.payload.runId === run.id).length)
  }, [run.id])

  const flushQueue = React.useCallback(async () => {
    const { flushInspectionSubmissionQueue } = await import("./offline-inspection-queue")
    const result = await flushInspectionSubmissionQueue(async (payload) => {
      const response = await completeInspectionRunAction(payload)
      // Un rechazo de validación o de estado no se arregla reintentando: se
      // quema de golpe para que no quede como zombi en la cola.
      return { ok: response.ok, message: response.message, retriable: response.ok ? undefined : false }
    })
    if (result.synchronized > 0) setOfflineNote("Inspección sincronizada.")
    else if (result.rejected > 0) {
      /* INS-19: el rechazo decía "revisa los datos" y el motivo real quedaba
       * en IndexedDB sin que nadie lo leyera — típicamente que la inspección
       * cambió en otra sesión y el CAS ya no cuadra. Sin el motivo, quien
       * ejecutó no sabe si rehacer el cierre o pedir ayuda. */
      const { listQueuedInspectionSubmissions } = await import("./offline-inspection-queue")
      const entries = await listQueuedInspectionSubmissions()
      const failed = entries.find((entry) => entry.payload.runId === run.id)
      setOfflineNote(failed?.lastError
        ? `La sincronización fue rechazada: ${failed.lastError}`
        : "La sincronización fue rechazada; revisa los datos.")
    }
    await refreshQueue()
  }, [refreshQueue, run.id])

  React.useEffect(() => {
    void refreshQueue()
    // Al volver la conexión se intenta enviar lo pendiente sin que el usuario
    // tenga que acordarse.
    function onOnline() { void flushQueue() }
    window.addEventListener("online", onOnline)
    return () => window.removeEventListener("online", onOnline)
  }, [refreshQueue, flushQueue])

  function captureLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) { setGeoState("denied"); return }
    setGeoState("pending")
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({ lat: position.coords.latitude.toFixed(6), lon: position.coords.longitude.toFixed(6) })
        setGeoState("idle")
      },
      // Degradación silenciosa: la ubicación es un dato de apoyo, nunca un
      // bloqueo para registrar la inspección.
      () => setGeoState("denied"),
      { enableHighAccuracy: true, timeout: 10_000 },
    )
  }

  function update(sectionId: string, itemId: string, patch: Partial<Draft>) {
    setRevision((value) => value + 1)
    setDrafts((current) => {
      const key = draftKey(sectionId, itemId)
      const base = current[key] ?? { result: "" as ResultValue, comment: "", value: "", needsConfirmation: false }
      // Responder el ítem lo ratifica: si la persona eligió el resultado, ya
      // miró la celda. Editar sólo el comentario no basta.
      const confirmedByAnswering = patch.result !== undefined
      return {
        ...current,
        [key]: { ...base, ...patch, needsConfirmation: confirmedByAnswering ? false : base.needsConfirmation },
      }
    })
  }

  /** Ratifica lo que leyó la máquina sin cambiar la respuesta. */
  function confirmRead(sectionId: string, itemId: string) {
    setRevision((value) => value + 1)
    setDrafts((current) => {
      const key = draftKey(sectionId, itemId)
      const base = current[key]
      if (!base) return current
      return { ...current, [key]: { ...base, needsConfirmation: false } }
    })
  }

  const currentAnswers: InspectionAnswerInput[] = React.useMemo(
    () => Object.entries(drafts)
      .filter(([, draft]) => draft.result !== "")
      .map(([key, draft]) => {
        const [sectionId, itemId] = key.split("::")
        return {
          sectionId: sectionId!,
          itemId: itemId!,
          result: draft.result as InspectionAnswerInput["result"],
          comment: draft.comment || null,
          value: draft.value || null,
          needsConfirmation: draft.needsConfirmation,
        }
      }),
    [drafts],
  )

  const completion = React.useMemo(
    () => assessRunCompletion(items, currentAnswers, { spec: closingAct, act: closingAct ? closing : null }),
    [items, currentAnswers, closingAct, closing],
  )
  const summary = React.useMemo(() => summarizeCompliance(items, currentAnswers, scoringPolicy), [items, currentAnswers, scoringPolicy])
  const answeredCount = currentAnswers.length
  // I-02: mismo conjunto que exige `assessRunCompletion` — antes el contador
  // usaba sólo `item.required`, y 11 de 12 plantillas del catálogo no declaran
  // ninguno, así que decía "0 de N" sobre inspecciones ya terminadas.
  const requiredItems = React.useMemo(() => effectiveRequiredItems(items), [items])
  const answeredRequired = React.useMemo(() => requiredItems.filter((item) => drafts[draftKey(item.sectionId, item.itemId)]?.result).length, [requiredItems, drafts])

  // B-03: la misma regla que aplica el servicio, evaluada antes de enviar.
  // Sin esto el CHECK de Postgres reventaba el lote entero y el usuario veía
  // el texto crudo de la violación.
  const itemBySpec = React.useMemo(
    () => new Map(items.map((item) => [draftKey(item.sectionId, item.itemId), item])),
    [items],
  )
  const [savedAnswerRows, setSavedAnswerRows] = React.useState(answers)
  React.useEffect(() => { setSavedAnswerRows(answers) }, [answers])

  // La evidencia cuelga de la respuesta persistida. El mapa se actualiza con
  // las claves que devuelve el autosave, por lo que elegir una foto puede
  // crear la respuesta y subirla en el mismo gesto.
  const savedAnswers = React.useMemo(
    () => new Map(savedAnswerRows.map((answer) => [draftKey(answer.sectionId, answer.itemId), answer])),
    [savedAnswerRows],
  )
  const rowProblemEntries = React.useMemo(
    () => currentAnswers.flatMap((answer) => {
      const item = itemBySpec.get(draftKey(answer.sectionId, answer.itemId))
      if (!item) return []
      const problem = validateAnswerRow(item, answer)
      return problem ? [{ key: draftKey(answer.sectionId, answer.itemId), problem }] : []
    }),
    [currentAnswers, itemBySpec],
  )
  const rowProblems = React.useMemo(() => rowProblemEntries.map((entry) => entry.problem), [rowProblemEntries])
  const completionBlockers = React.useMemo(() => {
    const seen = new Set(rowProblems)
    return completion.blockers.filter((item) => {
      if (seen.has(item.detail)) return false
      seen.add(item.detail)
      return true
    })
  }, [completion.blockers, rowProblems])

  /** Payload compartido por guardar y por declarar ejecutada: un solo contrato. */
  function answersPayload() {
    return {
      runId: run.id,
      expectedVersion: version,
      answers: currentAnswers,
      locationLatitude: coords?.lat ?? null,
      locationLongitude: coords?.lon ?? null,
    }
  }

  /** Payload de completar: respuestas + acta, todo en una transacción. */
  function completePayload() {
    return {
      ...answersPayload(),
      closingAct: closingAct
        ? {
            result: closing.result,
            restrictions: closing.restrictions || null,
            signatures: closing.signatures.filter((item) => item.name.trim().length > 0),
          }
        : undefined,
    }
  }

  async function queueOffline() {
    const { queueInspectionSubmission } = await import("./offline-inspection-queue")
    try {
      /* INS-18/INS-19: el mismo payload que manda el cierre en línea, sin
       * recomponerlo a mano. Antes se omitía `needsConfirmation` —hoy inocuo
       * porque el gate del cliente ya exige ratificar antes de habilitar el
       * botón, pero era una divergencia esperando a que esa condición cambie—
       * y viajaba un `clientSubmissionId` que `completeInspectionRun` descarta:
       * su Zod no lo declara. La idempotencia del reintento la da el bloque
       * `alreadyCompleted` del servicio (mismo ejecutante + ya ejecutada), no
       * ese campo. */
      await queueInspectionSubmission({
        ...(completePayload() as unknown as Omit<OfflineInspectionSubmission, "runId">),
        runId: run.id,
      })
      setOfflineNote("Guardada en el dispositivo. Se enviará al recuperar conexión.")
      await refreshQueue()
    } catch (error) {
      setOfflineNote(error instanceof Error ? error.message : "No se pudo guardar en el dispositivo.")
    }
  }

  function applyVersion(result: { data?: Record<string, unknown> }) {
    const next = result.data?.version
    if (typeof next === "number") setVersion(next)
  }

  function applySavedAnswerRefs(result: { data?: Record<string, unknown> }) {
    applyVersion(result)
    const refs = result.data?.answerRefs
    if (!Array.isArray(refs)) return
    setSavedAnswerRows((current) => {
      const byKey = new Map(current.map((answer) => [draftKey(answer.sectionId, answer.itemId), answer]))
      for (const value of refs) {
        if (!value || typeof value !== "object") continue
        const row = value as { answerId?: unknown; sectionId?: unknown; itemId?: unknown }
        if (typeof row.answerId !== "string" || typeof row.sectionId !== "string" || typeof row.itemId !== "string") continue
        const key = draftKey(row.sectionId, row.itemId)
        const previous = byKey.get(key)
        byKey.set(key, previous
          ? { ...previous, answerId: row.answerId }
          : {
              answerId: row.answerId,
              sectionId: row.sectionId,
              itemId: row.itemId,
              result: drafts[key]?.result ?? "",
              comment: drafts[key]?.comment || null,
              value: drafts[key]?.value || null,
              evidence: [],
              needsConfirmation: drafts[key]?.needsConfirmation ?? false,
            })
      }
      return [...byKey.values()]
    })
  }

  async function ensureAnswerSaved(key: string) {
    if (rowProblems.length > 0) throw new Error("Corrige las respuestas marcadas antes de adjuntar fotografías.")
    const result = await saveInspectionAnswersAction(answersPayload())
    if (!result.ok) throw new Error(result.message ?? "No se pudo guardar la respuesta.")
    applySavedAnswerRefs(result)
    operation.setMessage("Respuesta guardada y lista para recibir evidencia.")
    const refs = result.data?.answerRefs
    if (!Array.isArray(refs)) throw new Error("El servidor no devolvió la respuesta guardada.")
    const target = refs.find((value) => {
      if (!value || typeof value !== "object") return false
      const row = value as { sectionId?: unknown; itemId?: unknown }
      return draftKey(String(row.sectionId ?? ""), String(row.itemId ?? "")) === key
    }) as { answerId?: unknown } | undefined
    if (typeof target?.answerId !== "string") throw new Error("No se encontró la respuesta guardada.")
    return target.answerId
  }

  function saveAnswers() {
    const sending = revision
    operation.run(() => saveInspectionAnswersAction(answersPayload()), (result) => {
      applySavedAnswerRefs(result)
      setSavedRevision(sending)
      // El botón persiste exactamente lo mismo que el autoguardado, así que el
      // espejo del dispositivo tampoco tiene ya nada que rescatar. Sin esto,
      // `readInspectionDraft` lo restauraba la próxima vez que se montara la
      // pantalla, que avisaba "Se recuperaron respuestas sin enviar" sobre
      // respuestas ya guardadas.
      clearInspectionDraft(run.id)
      setRestoredDraft(false)
    })
  }

  /* INS-02: espejo del borrador en el propio dispositivo. Se escribe en cada
   * edición, antes y con independencia del autoguardado: en terreno el envío
   * al servidor es justo lo que falla, y el espejo es lo único que sobrevive a
   * cerrar la pestaña sin señal. */
  React.useEffect(() => {
    // `revision <= savedRevision` es "no hay nada sin enviar". Comparar contra 0
    // no bastaba: un guardado exitoso sube `version`, que es dependencia de este
    // efecto, así que volvía a escribir el espejo que `onSaved` acababa de
    // borrar, y la próxima vez que se montara la pantalla avisaba de
    // respuestas sin enviar que sí estaban guardadas.
    if (!editable || revision <= savedRevision) return
    writeInspectionDraft(run.id, { version, savedAt: new Date().toISOString(), drafts })
  }, [editable, revision, savedRevision, drafts, run.id, version])

  /* Autoguardado contra el servidor, con el mismo camino de escritura que el
   * botón. Reusa el hook que ya usa el motor SST para sus checklists — hasta
   * ahora Inspecciones era el único que obligaba a acordarse de guardar, y es
   * el que se ejecuta en terreno con 54 y hasta 75 ítems por delante.
   *
   * No se autoguarda con respuestas inválidas: el servidor las rechazaría
   * igual y el hook reintentaría en bucle contra una guarda. */
  const autosave = useDebouncedAutosave({
    watchKey: revision,
    isDirty: revision > savedRevision,
    onSave: () => {
      revisionInFlight.current = revision
      return saveInspectionAnswersAction(answersPayload())
    },
    onSaved: (result) => {
      applySavedAnswerRefs(result)
      setSavedRevision(revisionInFlight.current)
      // Persistido: el espejo dejó de tener nada que rescatar.
      clearInspectionDraft(run.id)
      setRestoredDraft(false)
    },
    enabled: editable && rowProblems.length === 0,
    debounceMs: 1200,
  })
  const savingAnswers = autosave.status === "saving"

  const facts = [
    { label: "Estado", value: inspectionTaskStatusLabel(run.status) },
    { label: "Tipo", value: INSPECTION_KIND_LABELS[templateKind] ?? templateKind },
    { label: "Origen", value: INSPECTION_ORIGIN_LABELS[run.origin] ?? run.origin },
    { label: "Faena", value: worksiteName },
    { label: "Sujeto", value: run.subjectType ? `${inspectionSubjectTypeLabel(run.subjectType)}${run.subjectLabel ? ` · ${run.subjectLabel}` : ""}` : run.subjectLabel ?? "—" },
    { label: "Asignada a", value: assigneeName ?? "Sin asignar" },
    { label: "Programada para", value: run.scheduledFor ? formatDate(run.scheduledFor) : "Sin fecha" },
    { label: "Ejecutada por", value: executorName ? `${executorName} · ${formatDateTime(run.executedAt!)}` : "Sin ejecutar" },
    {
      label: "Resultado oficial",
      value: (run.officialComplianceBasisPoints ?? summary.officialComplianceBasisPoints) === null
        ? "Sin fórmula en el documento"
        : `${(run.officialComplianceBasisPoints ?? summary.officialComplianceBasisPoints)! / 100}%`,
    },
    {
      label: "Resultado normalizado",
      value: (run.normalizedComplianceBasisPoints ?? summary.normalizedComplianceBasisPoints) === null
        ? "Aún no calculable"
        : `${(run.normalizedComplianceBasisPoints ?? summary.normalizedComplianceBasisPoints)! / 100}%`,
    },
    { label: "Ubicación", value: coords ? `${coords.lat}, ${coords.lon} · dato de apoyo opcional` : "No capturada · opcional" },
    // Qué acredita en el programa anual, y en qué etapa. El estado del run dice
    // si ya ocurrió: `completed` cierra la primera, `reviewed` la segunda.
    {
      label: "Acredita en el PDTP",
      value: [
        pdtpActivityNumbers.length > 0 ? `N° ${pdtpActivityNumbers.join(", ")} al ejecutar` : null,
        pdtpReviewActivityNumbers.length > 0 ? `N° ${pdtpReviewActivityNumbers.join(", ")} al revisar` : null,
      ].filter(Boolean).join(" · ") || "No acredita ninguna actividad",
    },
  ]
  const isExecutor = run.executedByUserId === currentUserId
  const canCurrentUserReview = run.status === "completed" && canReview && !isExecutor
  // I-08: el bloqueo cubría sólo la auto-revisión. Quien ejecutó SIN permiso
  // de revisión (p. ej. el jefe de terreno) tampoco puede cerrarla y antes no
  // veía ningún mensaje — sólo cambia el copy según tenga o no el permiso.
  const reviewBlocked = run.status === "completed" && isExecutor
  const selfReviewBlocked = reviewBlocked && canReview
  const showMobileActionBar = editable || canCurrentUserReview

  // I-09: en modo revisión el trabajo es juzgar los hallazgos, no recorrer el
  // checklist entero para llegar a ellos — se adelantan antes de las
  // secciones. En modo edición se quedan al final (recién se están
  // generando). Es una regla de lectura (¿hay algo que revisar?), no de
  // permiso: cualquiera que abre una inspección terminada los quiere primero.
  const findingsFirst = !editable && (run.status === "completed" || run.status === "reviewed")
  const findingsSection = (run.status === "completed" || run.status === "reviewed") ? (
    <section id="hallazgos" className="scroll-mt-16 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Hallazgos ({findings.length})</h2>
        {findings.length > 0 && run.subjectResourceId && canRequestRecharge && (
          <Button asChild size="sm" variant="secondary">
            <Link href={`/solicitudes/nueva?tipo=otro&recursoEmergencia=${encodeURIComponent(run.subjectResourceId)}`}>
              Solicitar recarga
            </Link>
          </Button>
        )}
      </div>
      {findings.length === 0 ? (
        <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-subtle)]">Sin hallazgos: todos los ítems evaluables cumplieron.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hallazgo</TableHead>
                <TableHead>Criticidad</TableHead>
                <TableHead>Estado</TableHead>
                {(canExecute || canReview) && <TableHead className="text-right">Acción</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {findings.map((finding) => (
                <TableRow key={finding.id}>
                  <TableCell className="text-sm">{finding.description}</TableCell>
                  <TableCell><MetaBadge meta={{ label: `${FINDING_CRITICALITY_LABELS[finding.criticality] ?? finding.criticality}`, variant: criticalityBadgeVariant(finding.criticality) }} /></TableCell>
                  <TableCell className="text-sm">
                    {FINDING_STATUS_LABELS[finding.status] ?? finding.status}
                    {finding.capaActionId && (
                      <Link href={`/prevencion/capa/${finding.capaActionId}`} className="ml-2 text-xs underline">Ver CAPA</Link>
                    )}
                  </TableCell>
                  {(canExecute || canReview) && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {canExecute && finding.status === "open" && <CapaDialog finding={finding} assignees={assignees} hasVehicle={!!run.subjectVehicleId} />}
                        {canStopVehicle && run.subjectVehicleId && ["high", "critical"].includes(finding.criticality) && (
                          <StopVehicleDialog finding={finding} subjectLabel={run.subjectLabel} />
                        )}
                        {/* B-06: cierre manual sólo para hallazgos sin CAPA.
                            Los que la tienen se cierran al verificar o
                            cerrar su acción, en la misma transacción. */}
                        {canReview && finding.status === "open" && !finding.capaActionId && (
                          <ReasonDialog
                            trigger="Cerrar"
                            title="Cerrar hallazgo"
                            description={finding.description}
                            action={(reason) => closeInspectionFindingAction({ findingId: finding.id, reason })}
                            variant="ghost-danger"
                          />
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  ) : null

  return (
    <div className={showMobileActionBar ? "space-y-6 pb-24 md:pb-0" : "space-y-6"}>
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:hidden">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-eyebrow">Trabajo actual</p>
            <p className="mt-1 text-base font-semibold">{worksiteName}{run.subjectLabel ? ` · ${run.subjectLabel}` : ""}</p>
          </div>
          <MetaBadge meta={{ label: `${inspectionTaskStatusLabel(run.status)}`, variant: runStatusBadgeVariant(run.status) }} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
          <div><span className="block text-[var(--color-text-subtle)]">Responsable</span><span className="mt-0.5 block font-medium">{assigneeName ?? "Sin asignar"}</span></div>
          {/* I-02: sin obligatorios efectivos (instrumento de un solo ítem de
              texto libre) "0 de N obligatorios" mentía igual que antes, sólo
              que al revés — se muestra el avance total en su lugar. */}
          <div>
            <span className="block text-[var(--color-text-subtle)]">{requiredItems.length > 0 ? "Avance obligatorio" : "Avance"}</span>
            <span className="mt-0.5 block font-medium">{requiredItems.length > 0 ? `${answeredRequired} de ${requiredItems.length}` : `${answeredCount} de ${items.length}`}</span>
          </div>
        </div>
        <details className="mt-3 border-t border-[var(--color-border)] pt-3 text-sm">
          <summary className="cursor-pointer font-medium">Ver contexto completo</summary>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            {facts.slice(1).map((fact) => <div key={fact.label}><dt className="text-xs text-[var(--color-text-subtle)]">{fact.label}</dt><dd className="mt-0.5 text-xs font-medium">{fact.value}</dd></div>)}
          </dl>
        </details>
      </section>

      <div className="hidden grid-cols-2 gap-px overflow-hidden border-y border-[var(--color-border)] bg-[var(--color-border)] md:grid md:grid-cols-4">
        {facts.map((fact) => (
          <div key={fact.label} className="bg-[var(--color-surface)] px-4 py-3">
            <span className="text-eyebrow">{fact.label}</span>
            <span className="mt-1 block text-sm font-medium">{fact.value}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MetaBadge meta={{ label: `${inspectionTaskStatusLabel(run.status)}`, variant: runStatusBadgeVariant(run.status) }} />
          <span className="text-sm text-[var(--color-text-subtle)]">
            {requiredItems.length > 0 && `${answeredRequired} de ${requiredItems.length} obligatorios · `}
            {answeredCount} de {items.length} {requiredItems.length > 0 ? "totales" : "respondidos"}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={operation.pending || geoState === "pending"}
              onClick={captureLocation}
            >
              {coords ? `Ubicación ${coords.lat}, ${coords.lon}` : geoState === "pending" ? "Ubicando…" : "Capturar ubicación"}
            </Button>
          )}
          {editable && (
            <>
              <Button className="hidden md:inline-flex" type="button" size="sm" variant="secondary" disabled={operation.pending || savingAnswers || rowProblems.length > 0} onClick={saveAnswers}>
                {savingAnswers ? "Guardando…" : "Guardar respuestas"}
              </Button>
              {/* INS-02: el autoguardado necesita decir en qué estado está, o
                  quien ejecuta no sabe si puede irse de la pantalla. */}
              <span role="status" className="hidden self-center text-xs text-[var(--color-text-subtle)] md:inline">
                {autosaveStatusLabel(autosave.status)}
              </span>
            </>
          )}
          {/* Función #3: el acta de LA inspección. El export Excel es agregado
              y en fiscalización se pide esta. */}
          {["completed", "reviewed"].includes(run.status) && (
            <Button asChild size="sm" variant="secondary">
              <a href={`/prevencion/inspecciones/${run.id}/print`} target="_blank" rel="noreferrer">Acta PDF</a>
            </Button>
          )}
          {editable && <span className="hidden md:inline-flex"><CompleteDialog run={run} completion={completion} rowProblems={rowProblems} payload={completePayload} onSaved={applyVersion} saving={savingAnswers} /></span>}
          {canCurrentUserReview && (
            <span className="hidden md:inline-flex"><ReviewDialog run={run} findings={findings} currentUserId={currentUserId} version={version} assignees={assignees} canExecute={canExecute} /></span>
          )}
          {/* A-05: rectificar una ejecución declarada por error. Antes no
              existía camino de vuelta y el dato quedaba firmado. */}
          {canReview && ["completed", "reviewed"].includes(run.status) && (
            <ReasonDialog
              trigger="Reabrir para rectificar"
              title={`Reabrir ${run.code}`}
              description="Vuelve la inspección a ejecución: borra el cumplimiento calculado y los hallazgos que no tengan CAPA. Los que ya tienen acción correctiva se conservan."
              action={(reason) => reopenInspectionRunAction({ runId: run.id, expectedVersion: version, reason })}
              onDone={applyVersion}
            />
          )}
          {/* A-04: cancelar una planificada que ya no corresponde. */}
          {canManage && ["planned", "in_progress", "completed"].includes(run.status) && (
            <ReasonDialog
              trigger="Cancelar"
              title={`Cancelar ${run.code}`}
              description="La inspección deja de estar pendiente y sale de la bandeja. No se puede deshacer."
              action={(reason) => cancelInspectionRunAction({ runId: run.id, expectedVersion: version, reason })}
              onDone={applyVersion}
              variant="ghost-danger"
            />
          )}
        </div>
      </div>

      {operation.message && <p role="status" className="rounded-lg border border-[var(--color-success-line)] bg-[var(--color-success-tint)] px-3 py-2 text-sm text-[var(--color-success-ink)] md:static">{operation.message}</p>}

      {/* INS-02: el borrador que sobrevivió en el dispositivo. Se dice, no se
          aplica en silencio: quien vuelve tiene que saber que lo que ve son sus
          respuestas sin enviar y no lo que el servidor tiene guardado. */}
      {restoredDraft && (
        <p role="status" className="rounded-lg border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] px-3 py-2 text-sm text-[var(--color-warning-ink)]">
          Se recuperaron respuestas sin enviar de este dispositivo. Se guardarán solas al recuperar conexión, o pulsa «Guardar respuestas».
        </p>
      )}

      {/* El hook reintenta solo, pero callarlo dejaría a alguien creyendo que
          su trabajo está a salvo cuando la faena no tiene señal. */}
      {autosave.error && (
        <p role="status" className="rounded-lg border border-[var(--color-danger-line)] bg-[var(--color-surface-2)] px-3 py-2 text-sm">
          {autosave.error} Tus respuestas siguen guardadas en este dispositivo.
        </p>
      )}

      {reviewBlocked && (
        <div className="rounded-lg border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] px-3 py-2 text-sm text-[var(--color-warning-ink)]">
          <p>
            {selfReviewBlocked
              ? "Tú ejecutaste esta inspección. Para conservar la revisión segregada, debe cerrarla otra persona con permiso de revisión."
              : "Ejecutaste esta inspección y no tienes permiso para revisarla. Debe cerrarla otra persona con permiso de revisión."}
            {reviewers.length > 0 && ` Puede cerrarla: ${reviewers.map((reviewer) => reviewer.name).join(", ")}.`}
          </p>
          {reviewers.length > 0 && <RemindReviewButton runId={run.id} />}
          {reviewers.length === 0 && <p className="mt-1">Nadie con permiso de revisión está asignado a esta faena. Avisa a Prevención.</p>}
        </div>
      )}

      {physicalSourceRequired && (
        <section className="space-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div>
            <p className="text-eyebrow">Paso 1 · documento fuente</p>
            <h2 className="mt-1 text-base font-semibold">Transcribir el Reporte de Equipos</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">El jefe de faena carga y transcribe el registro físico del operador/mecánico. Prevención revisa y cierra después; no corresponde que quien transcribe se auto-revise.</p>
          </div>
          {canIngest && editable && <SourceFormUpload runId={run.id} hasDocuments={documents.length > 0} />}
          {documents.length > 0 && <div className="lg:hidden"><SourceFormViewer documents={documents} /></div>}
        </section>
      )}

      {/* Función #9: en terreno la conexión falla justo cuando hay que cerrar
          la inspección. El envío queda en el dispositivo y se reintenta solo. */}
      {editable && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Button type="button" size="sm" variant="ghost" onClick={() => void queueOffline()} disabled={operation.pending || !completion.allowed}>
            Encolar cierre en este dispositivo
          </Button>
          <span className="text-xs text-[var(--color-text-subtle)]">Sólo protege el cierre cuando ya está listo; no guarda fotografías ni planillas.</span>
          {queued > 0 && (
            <>
              <span className="text-[var(--color-text-subtle)]">1 cierre pendiente de sincronizar.</span>
              <Button type="button" size="sm" variant="secondary" onClick={() => void flushQueue()}>Sincronizar</Button>
            </>
          )}
          {offlineNote && <span role="status">{offlineNote}</span>}
        </div>
      )}

      {editable && geoState === "denied" && (
        <p className="text-sm text-[var(--color-text-subtle)]">
          No se pudo obtener la ubicación. La inspección se registra igual.
        </p>
      )}

      {editable && (rowProblemEntries.length > 0 || completionBlockers.length > 0) && (
        <div className="rounded-md border border-[var(--color-danger-line)] bg-[var(--color-surface-2)] p-4 text-sm">
          <p className="font-medium">Corrige antes de guardar o declarar ejecutada:</p>
          {/* I-06: lista completa con scroll interno, no un "y N más…" mudo. */}
          <ul className="mt-2 max-h-56 list-disc space-y-1 overflow-y-auto pl-4">
            {rowProblemEntries.map((entry) => <li key={entry.key}>
              <button type="button" className="text-left underline" onClick={() => jumpToItem(entry.key)}>{entry.problem}</button>
            </li>)}
            {completionBlockers.map((item) => {
              const key = item.sectionId && item.itemId ? draftKey(item.sectionId, item.itemId) : null
              return (
                <li key={item.detail}>
                  {key ? <button type="button" className="text-left underline" onClick={() => jumpToItem(key)}>{item.detail}</button> : item.detail}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* I-09: ya no depende de `editable` — un índice de secciones sirve a
          cualquiera que lea el checklist, no sólo a quien ejecuta. */}
      {sections.length > 1 && (
        <nav aria-label="Secciones de la inspección" className="sticky top-0 z-10 -mx-1 flex gap-2 overflow-x-auto bg-[var(--color-bg)] px-1 py-2 md:static md:bg-transparent">
          {findingsFirst && findingsSection && (
            <a href="#hallazgos" className="shrink-0 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-medium">Hallazgos ({findings.length})</a>
          )}
          {sections.map((section, index) => <a key={section.id} href={`#section-${section.id}`} className="shrink-0 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-medium">{sectionNavLabel(section.title, index)}</a>)}
        </nav>
      )}

      {findingsFirst && findingsSection}

      <div className={documents.length > 0
        ? "grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start"
        : undefined}
      >
        <div className="space-y-4">
        {sections.map((section, sectionIndex) => (
          <section key={section.id} id={`section-${section.id}`} className="scroll-mt-16 space-y-3">
            <p className="text-eyebrow">Sección {sectionIndex + 1} de {sections.length}</p>
            <h2 className="text-sm font-semibold">{section.title}</h2>
            <div className="space-y-3 md:hidden">
              {section.items.map((item, itemIndex) => {
                const key = draftKey(section.id, item.id)
                const draft = drafts[key] ?? { result: "" as ResultValue, comment: "", value: "", needsConfirmation: false }
                // I-05: "No cumple" exige motivo igual que "No aplica"/"Regular" — es
                // el resultado que genera el hallazgo.
                const needsComment = draft.result === "not_applicable" || draft.result === "partial" || draft.result === "non_conforming"
                const scorable = fieldKindIsScorable(item.kind)
                return (
                  <article key={item.id} id={`item-mobile-${key}`} className="scroll-mt-28 space-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-sm font-semibold leading-snug">
                        {itemIndex + 1}. {item.matrix?.rowLabel ?? item.label}
                        {item.matrix && <span className="ml-2 text-xs font-medium text-[var(--color-text-subtle)]">{item.matrix.columnLabel}</span>}
                      </h3>
                      {item.required ? <MetaBadge meta={{ label: "Obligatorio", variant: "outline" }} /> : <span className="text-xs text-[var(--color-text-subtle)]">Opcional</span>}
                    </div>
                    {draft.needsConfirmation && (
                      <div className="flex flex-wrap items-center gap-2">
                        <MetaBadge meta={{ label: "Leído de la planilla", variant: "warning" }} />
                        {editable && <Button type="button" size="sm" variant="secondary" onClick={() => confirmRead(section.id, item.id)}>Confirmar contra la foto</Button>}
                      </div>
                    )}
                    {scorable ? (
                      <>
                        <Field label="Resultado" required={item.required}>
                          {editable ? (
                            <Select value={draft.result || "__unset__"} onValueChange={(value) => update(section.id, item.id, { result: (value === "__unset__" ? "" : value) as ResultValue })}>
                              {/* I-13: color visible también mientras se edita, no sólo en el badge de lectura. */}
                              <SelectTrigger aria-label={`Resultado de ${item.label}`} className={resultSelectToneClass(draft.result)}><SelectValue placeholder="Sin responder" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__unset__">Sin responder</SelectItem>
                                {/* INS-01: las opciones salen de la escala del ítem, no del
                                    mapa global. Ofrecer "No aplica" en un Anexo 13 dejaba
                                    sacar del denominador un ítem que el papel obliga a
                                    juzgar; y ahora la etiqueta es la del anexo ("Bueno"). */}
                                {inspectionResultOptionsFor(item.kind).map((option) => (
                                  <SelectItem key={option.result} value={option.result}>{option.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : draft.result ? <MetaBadge meta={{ label: `${inspectionResultLabel(item.kind, draft.result)}`, variant: resultBadgeVariant(draft.result) }} /> : <span>Sin respuesta</span>}
                        </Field>
                        <Field label="Comentario" hint={needsComment ? `Obligatorio para "${inspectionResultLabel(item.kind, draft.result)}"; mínimo 3 caracteres.` : "Opcional, salvo que el resultado requiera justificación."}>
                          {editable ? <Textarea value={draft.comment} onChange={(event) => update(section.id, item.id, { comment: event.target.value })} rows={3} aria-label={`Comentario de ${item.label}`} /> : <p className="text-sm">{draft.comment || "Sin comentario"}</p>}
                        </Field>
                      </>
                    ) : (
                      <Field label="Respuesta" required={item.required}>
                        {editable ? <NonScorableField item={item} value={draft.value} onChange={(next) => update(section.id, item.id, { value: next, result: next.trim() ? "recorded" : "" })} />
                          // I-17: un ítem tipo fecha guarda ISO (YYYY-MM-DD); en lectura se formatea igual que el resto de la pantalla.
                          : <p className="whitespace-pre-wrap text-sm">{draft.value ? (item.kind === "date" ? formatDate(draft.value) : draft.value) : "Sin respuesta"}</p>}
                      </Field>
                    )}
                    <Field label="Evidencia fotográfica" hint="La foto queda vinculada a este ítem.">
                      <AnswerEvidence
                        answerId={savedAnswers.get(key)?.answerId ?? null}
                        evidence={savedAnswers.get(key)?.evidence ?? []}
                        editable={editable}
                        readyToPersist={draft.result !== ""}
                        ensureAnswerId={() => ensureAnswerSaved(key)}
                      />
                    </Field>
                  </article>
                )
              })}
            </div>
            <div className="hidden overflow-x-auto rounded-lg border border-[var(--color-border)] md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ítem</TableHead>
                    <TableHead className="w-44">Resultado</TableHead>
                    <TableHead>Comentario</TableHead>
                    <TableHead className="w-44">Evidencia</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {section.items.map((item) => {
                    const key = draftKey(section.id, item.id)
                    const draft = drafts[key] ?? { result: "" as ResultValue, comment: "", value: "", needsConfirmation: false }
                    // 'Regular' exige justificarse por escrito igual que 'No aplica'
                    // — mismo criterio que el motor SST (requiresObservation).
                    // I-05: "No cumple" exige motivo igual que "No aplica"/"Regular" — es
                    // el resultado que genera el hallazgo.
                    const needsComment = draft.result === "not_applicable" || draft.result === "partial" || draft.result === "non_conforming"
                    // B-08: un ítem que no expresa conformidad se responde con
                    // su contenido. Antes se le ofrecía "Cumple / No cumple" y
                    // el texto no tenía dónde guardarse.
                    const scorable = fieldKindIsScorable(item.kind)
                    return (
                      <TableRow key={item.id} id={`item-desktop-${key}`} className="scroll-mt-20">
                        <TableCell className="text-sm">
                          {item.matrix ? (
                            <span><span className="font-medium">{item.matrix.rowLabel}</span><span className="ml-2 text-xs text-[var(--color-text-subtle)]">{item.matrix.columnLabel}</span></span>
                          ) : item.label}
                          {item.required && <MetaBadge meta={{ label: "Obligatorio", variant: "outline" }} className="ml-2" />}
                          {draft.needsConfirmation && (
                            <span className="mt-1 flex flex-wrap items-center gap-2">
                              <MetaBadge meta={{ label: "Leído de la planilla", variant: "warning" }} />
                              {editable && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => confirmRead(section.id, item.id)}
                                >
                                  Confirmar contra la foto
                                </Button>
                              )}
                            </span>
                          )}
                        </TableCell>
                        {scorable ? (
                          <>
                            <TableCell>
                              {editable ? (
                                <Select value={draft.result || "__unset__"} onValueChange={(v) => update(section.id, item.id, { result: (v === "__unset__" ? "" : v) as ResultValue })}>
                                  <SelectTrigger aria-label={`Resultado de ${item.label}`}><SelectValue placeholder="Sin responder" /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__unset__">Sin responder</SelectItem>
                                    {inspectionResultOptionsFor(item.kind).map((option) => (
                                      <SelectItem key={option.result} value={option.result}>{option.label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : draft.result ? (
                                <MetaBadge meta={{ label: `${inspectionResultLabel(item.kind, draft.result)}`, variant: resultBadgeVariant(draft.result) }} />
                              ) : "—"}
                            </TableCell>
                            <TableCell>
                              {editable ? (
                                <Input
                                  value={draft.comment}
                                  onChange={(event) => update(section.id, item.id, { comment: event.target.value })}
                                  // El motivo nombra el resultado como lo nombra el instrumento:
                                  // en un Anexo B/R/M pide "Motivo del Malo", no "del No cumple".
                                  placeholder={needsComment ? `Motivo del "${inspectionResultLabel(item.kind, draft.result)}" (mínimo 3 caracteres)` : "Opcional"}
                                  aria-label={`Comentario de ${item.label}`}
                                />
                              ) : (
                                <span className="text-sm text-[var(--color-text-subtle)]">{draft.comment || "—"}</span>
                              )}
                            </TableCell>
                          </>
                        ) : (
                          // El valor ES la respuesta, así que ocupa las dos
                          // columnas de conformidad: no hay nada que juzgar aparte.
                          <TableCell colSpan={2}>
                            {editable ? (
                              <NonScorableField
                                item={item}
                                value={draft.value}
                                onChange={(next) => update(section.id, item.id, {
                                  value: next,
                                  // El estado acompaña al contenido: sin valor
                                  // el ítem vuelve a "sin responder" y el
                                  // guardado lo borra (B-02).
                                  result: next.trim() ? "recorded" : "",
                                })}
                              />
                            ) : (
                              // I-17: mismo formato que el resto de la pantalla para un ítem tipo fecha.
                              <span className="text-sm whitespace-pre-wrap">{draft.value ? (item.kind === "date" ? formatDate(draft.value) : draft.value) : "—"}</span>
                            )}
                          </TableCell>
                        )}
                        <TableCell>
                          <AnswerEvidence
                            answerId={savedAnswers.get(key)?.answerId ?? null}
                            evidence={savedAnswers.get(key)?.evidence ?? []}
                            editable={editable}
                            readyToPersist={draft.result !== ""}
                            ensureAnswerId={() => ensureAnswerSaved(key)}
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </section>
        ))}
        </div>
        {documents.length > 0 && (physicalSourceRequired
          ? <div className="hidden lg:block"><SourceFormViewer documents={documents} /></div>
          : <SourceFormViewer documents={documents} />)}
      </div>

      {/* Los instrumentos que no puntúan ítems registran lo que encontraron. La
          gravedad la trae el catálogo, así que el plazo de la acción correctiva
          no depende de quien está en terreno. */}
      {recordsDeviations && (
        <>
        {isUnplannedInspection && (
          <ParticipantsPanel runId={run.id} participants={participants} editable={editable && canExecute} />
        )}
        <DeviationsPanel
          runId={run.id}
          editable={editable}
          canExecute={canExecute}
          catalog={deviationCatalog}
          registered={findings.filter((finding) => finding.origin === "deviation")}
          narrative={isUnplannedInspection}
        />
        </>
      )}
      {recordsPreventiveActions && (
        <PreventiveActionsPanel runId={run.id} actions={findings.filter((finding) => finding.origin === "deviation")} assignees={assignees} editable={editable && canExecute} />
      )}

      {!physicalSourceRequired && canIngest && editable && <SourceFormUpload runId={run.id} hasDocuments={documents.length > 0} />}

      {closingAct && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">{closingAct.title}</h2>
          {editable ? (
            <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-4">
              <Field label="Resultado" required>
                <Select value={closing.result || "__unset__"} onValueChange={(value) => setClosing((c) => ({ ...c, result: value === "__unset__" ? "" : value }))}>
                  <SelectTrigger aria-label="Resultado del acta"><SelectValue placeholder="Sin declarar" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unset__">Sin declarar</SelectItem>
                    {closingAct.resultOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              {closingAct.hasRestrictions && (
                <Field label="Restricciones" hint="Opcional.">
                  <Textarea
                    value={closing.restrictions ?? ""}
                    onChange={(event) => setClosing((c) => ({ ...c, restrictions: event.target.value }))}
                    maxLength={3000}
                    aria-label="Restricciones del acta"
                  />
                </Field>
              )}
              {closing.signatures.length > 0 && (
                <div className="grid gap-3 md:grid-cols-2">
                  {closing.signatures.map((signature, index) => (
                    /* Sin `htmlFor` a propósito: el `Input` ya declara su
                     * `aria-label` abajo, y pasarlo haría que `Field` inyecte un
                     * `aria-labelledby` que lo pisa —el nombre accesible pasaría
                     * de "Firma de prevencionista" a "Firma: prevencionista"— y
                     * rompe a todo el que localice el campo por su nombre. */
                    <Field key={signature.role} label={`Firma: ${formatSignatureRole(signature.role)}`} hint="Nombre de quien firma.">
                      <Input
                        value={signature.name}
                        onChange={(event) => setClosing((c) => ({
                          ...c,
                          signatures: c.signatures.map((item, i) => i === index ? { ...item, name: event.target.value } : item),
                        }))}
                        maxLength={200}
                        aria-label={`Firma de ${formatSignatureRole(signature.role)}`}
                      />
                    </Field>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1 rounded-lg border border-[var(--color-border)] p-4 text-sm">
              <p>
                <span className="text-[var(--color-text-subtle)]">Resultado: </span>
                {closingAct.resultOptions.find((option) => option.value === run.closingResult)?.label ?? run.closingResult ?? "—"}
              </p>
              {run.closingRestrictions && <p><span className="text-[var(--color-text-subtle)]">Restricciones: </span>{run.closingRestrictions}</p>}
              {run.closingSignatures?.map((signature) => (
                <p key={signature.role}>
                  <span className="text-[var(--color-text-subtle)]">{formatSignatureRole(signature.role)}: </span>
                  {signature.name} · {formatDateTime(signature.signedAt)}
                </p>
              ))}
            </div>
          )}
        </section>
      )}

      {/* I-09: en modo edición se quedan al final; en revisión ya se movieron
          justo después de la barra de secciones. */}
      {!findingsFirst && findingsSection}

      {run.status === "reviewed" && run.reviewComment && (
        <p className="text-sm text-[var(--color-text-subtle)]">
          Revisada {formatDateTime(run.reviewedAt!)} por {reviewerName ?? "—"}: {run.reviewComment}
        </p>
      )}

      {showMobileActionBar && (
        <div className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 grid grid-cols-2 gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-lg)] md:hidden">
          {editable ? (
            <>
              <Button type="button" variant="secondary" disabled={operation.pending || savingAnswers || rowProblems.length > 0} onClick={saveAnswers}>{savingAnswers ? "Guardando…" : "Guardar"}</Button>
              <CompleteDialog run={run} completion={completion} rowProblems={rowProblems} payload={completePayload} onSaved={applyVersion} saving={savingAnswers} />
            </>
          ) : canCurrentUserReview ? (
            <div className="col-span-2"><ReviewDialog run={run} findings={findings} currentUserId={currentUserId} version={version} assignees={assignees} canExecute={canExecute} /></div>
          ) : null}
        </div>
      )}
    </div>
  )
}
