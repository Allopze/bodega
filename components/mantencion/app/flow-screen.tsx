"use client"

import { useEffect, useMemo, useReducer, useRef, useState } from "react"
import { createDraftSaver, discardDraft, saveDraft } from "@/lib/mantencion/client/drafts"
import { StorageFullError } from "@/lib/mantencion/client/db"
import { flowReducer } from "@/lib/mantencion/client/flow"
import { buildFlowEnv } from "@/lib/mantencion/client/flow-env"
import { buildRecord } from "@/lib/mantencion/client/flow-record"
import { draftHasContent, draftKey, stepsFor, type FlowDraft } from "@/lib/mantencion/client/flow-types"
import { checklistCounts, faltaText, validateAll } from "@/lib/mantencion/client/flow-validate"
import { commitRecord, newRecordItem } from "@/lib/mantencion/client/queue"
import { getOfflineSince } from "@/lib/mantencion/client/signal"
import { plural } from "@/lib/mantencion/format"
import { todayInChile } from "@/lib/utils"
import { useAppActions, useAppData } from "./app-context"
import { SaveOrDiscardDialog } from "./dialog"
import { IconBack, IconWifiOff } from "./icons"
import { PautaStatus, StepPauta } from "./step-pauta"
import { StepEquipo } from "./step-equipo"
import { StepFotos } from "./step-fotos"
import { StepLectura } from "./step-lectura"
import { StepRevisar } from "./step-revisar"
import { StepTrabajo } from "./step-trabajo"
import { FieldError } from "./ui"

/**
 * El registro paso a paso. El estado vive en un reductor puro (flow.ts) y se
 * guarda solo en IndexedDB: una llamada, la batería o cerrar la app no cuestan el
 * trabajo hecho. Lo único que sale de aquí es «Firmar y guardar», que entra el
 * registro a la cola de envío en una sola transacción.
 */
export function FlowScreen({ initial, onExit, onSigned }: { initial: FlowDraft; onExit: () => void; onSigned: (id: string) => void }) {
  const { rows, account, deviceId, appVersion, online } = useAppData()
  const { syncNow, toast } = useAppActions()
  const [draft, dispatch] = useReducer(flowReducer, initial)
  const [confirmExit, setConfirmExit] = useState(false)
  const [exiting, setExiting] = useState(false)
  const [exitError, setExitError] = useState<string | null>(null)
  const [signing, setSigning] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const finished = useRef(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [saver] = useState(() => createDraftSaver({
    onError: (cause) => setNotice(cause instanceof StorageFullError ? cause.message : "No pudimos guardar el borrador. Sigue: lo que ingresas se mantiene en pantalla."),
  }))

  const steps = stepsFor(draft.kind)
  const name = steps[draft.step] ?? "equipo"
  const row = useMemo(() => rows.find((entry) => entry.eq.id === draft.vehicleId) ?? null, [rows, draft.vehicleId])
  const ctx = useMemo(() => ({ row, today: todayInChile() }), [row])
  const env = useMemo(() => buildFlowEnv(ctx), [ctx])

  useEffect(() => {
    if (finished.current || !draftHasContent(draft)) return
    saver.schedule({ ...draft, errors: {}, updatedAt: new Date().toISOString() })
  }, [draft, saver])

  useEffect(() => {
    const flush = () => { if (!finished.current) void saver.flush() }
    const onHide = () => { if (document.visibilityState === "hidden") flush() }
    document.addEventListener("visibilitychange", onHide)
    window.addEventListener("pagehide", flush)
    return () => { document.removeEventListener("visibilitychange", onHide); window.removeEventListener("pagehide", flush); flush() }
  }, [saver])

  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }) }, [draft.step])

  useEffect(() => {
    if (Object.keys(draft.errors).length === 0) return
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    requestAnimationFrame(() => bodyRef.current?.querySelector<HTMLElement>(".err, .ask")?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" }))
  }, [draft.errors])

  /** «Descartar registro»: borra el borrador y sus fotos. Sólo se llega aquí por una elección explícita. */
  const discardAndExit = async () => {
    finished.current = true
    saver.cancel()
    await discardDraft(draft).catch(() => {})
    onExit()
  }
  /** «Guardar y salir»: deja el borrador guardado y vuelve al inicio, que lo ofrece para seguir. */
  const saveAndExit = async () => {
    setExiting(true)
    setExitError(null)
    saver.cancel()
    try {
      await saveDraft({ ...draft, errors: {}, updatedAt: new Date().toISOString() })
    } catch (cause) {
      // No se guardó: se queda aquí, con lo ingresado intacto, y se dice por qué.
      setExitError(cause instanceof StorageFullError ? cause.message : "No pudimos guardar tu avance en el teléfono. Sigue registrando, o descártalo si no lo necesitas.")
      setExiting(false)
      return
    }
    finished.current = true
    toast("Avance guardado en este teléfono.")
    onExit()
  }
  const closeExit = () => { setConfirmExit(false); setExitError(null) }
  // Sin equipo ni fotos no hay nada que guardar: se sale sin preguntar.
  const requestExit = () => { if (draftHasContent(draft)) setConfirmExit(true); else void discardAndExit() }
  const back = () => { if (draft.step === 0) requestExit(); else dispatch({ type: "back" }) }
  const next = () => dispatch({ type: "next", env })
  const confirmAnd = (patch: Partial<FlowDraft>) => { dispatch({ type: "patch", patch }); dispatch({ type: "next", env }) }

  const sign = async () => {
    if (signing || !row) return
    const problem = validateAll(draft, steps, ctx)
    if (problem) {
      dispatch({ type: "goStep", step: steps.indexOf(problem.step), backToReview: true })
      dispatch({ type: "errors", errors: problem.errors })
      toast("Falta completar algo antes de firmar.")
      return
    }
    const built = buildRecord(draft, { row, deviceId, appVersion, offlineSince: getOfflineSince(), now: new Date() })
    if (!built.ok) { setNotice(built.message); return }
    setSigning(true)
    setNotice(null)
    saver.cancel()
    try {
      await commitRecord(
        newRecordItem({ authorUserId: account.userId, payload: built.payload, summary: built.summary, photoIds: built.photoIds }),
        { draftKey: draftKey(draft.userId, draft.kind), replaceQueueId: draft.replacesQueueId },
      )
      finished.current = true
      syncNow()
      onSigned(draft.id)
    } catch (cause) {
      // Nada se guardó: el borrador sigue aquí tal cual.
      setNotice(cause instanceof StorageFullError ? cause.message : "No pudimos guardar el registro. Lo que ingresaste sigue aquí: intenta de nuevo.")
      setSigning(false)
    }
  }

  const returning = draft.ret !== null && name !== "revisar"
  const counts = checklistCounts(draft)
  const left = counts.total - counts.done
  const footNote = name === "pauta"
    ? (left > 0 ? `${faltaText(left, "ítem", "ítems")}. Todos son obligatorios.` : counts.missingReason > 0 ? `Falta el motivo de ${plural(counts.missingReason, "ítem no realizado", "ítems no realizados")}.` : "Pauta completa.")
    : name === "revisar" ? `Firmas como ${account.name}. Después de guardar no se puede editar.` : null
  const footLabel = {
    equipo: row ? `Continuar con ${row.eq.code}` : "Continuar",
    lectura: draft.kind === "P" ? "Ver pauta" : "Continuar",
    pauta: "Continuar a fotos",
    revisar: signing ? "Guardando…" : "Firmar y guardar",
    fotos: "Revisar registro",
    trabajo: "Continuar a fotos",
  }[name]
  // «Continuar» queda siempre habilitado y valida al tocarlo: dice qué falta y lleva hasta ahí (el reductor deja los errores
  // a la vista y el efecto de arriba desplaza al primero). Sólo se bloquea mientras se guarda la firma, para no firmar dos veces.
  const footDisabled = name === "revisar" && signing

  const title = draft.kind === "P" ? "Nueva preventiva" : "Nueva correctiva"
  return (
    <div className="scr">
      <div className="top">
        <div className="toprow">
          <button type="button" className="ibtn" onClick={back} aria-label={draft.step ? "Paso anterior" : "Volver al inicio"}><IconBack /></button>
          <div className="ttl">{title}</div>
          <div className="stepn">PASO {draft.step + 1}/{steps.length}</div>
          <button type="button" className="exitb" onClick={requestExit} aria-label="Salir del registro">Salir</button>
        </div>
        <div className="prog" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} role="progressbar" aria-label="Avance del registro" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={draft.step + 1}>
          {steps.map((step, index) => <span key={step} className={index <= draft.step ? "on" : ""} />)}
        </div>
        {online ? null : <div className="offpill"><IconWifiOff />Sin señal · se guarda en el teléfono</div>}
      </div>
      {name === "pauta" && row ? <PautaStatus draft={draft} row={row} /> : null}
      <div className="body" id="flow-body" ref={bodyRef}>
        {name === "equipo" ? <StepEquipo draft={draft} dispatch={dispatch} /> : !row ? (
          <>
            <p className="hint">Este equipo ya no está en la lista del teléfono.</p>
            <button type="button" className="btns wide" onClick={() => dispatch({ type: "goStep", step: 0, backToReview: false })}>Elegir otro equipo</button>
          </>
        ) : name === "lectura" ? (
          <StepLectura draft={draft} dispatch={dispatch} row={row} onChangeEquipment={() => dispatch({ type: "goStep", step: 0, backToReview: false })} onConfirm={confirmAnd} />
        ) : name === "pauta" ? <StepPauta draft={draft} dispatch={dispatch} />
          : name === "fotos" ? <StepFotos draft={draft} dispatch={dispatch} row={row} deviceId={deviceId} />
            : name === "trabajo" ? <StepTrabajo draft={draft} dispatch={dispatch} row={row} />
              : <StepRevisar draft={draft} row={row} onChange={(step) => dispatch({ type: "goStep", step, backToReview: true })} />}
      </div>
      <div className="foot" id="foot">
        <FieldError message={notice ?? undefined} />
        {footNote ? <div className="fnote">{footNote}</div> : null}
        <button type="button" className="btnp" id={name === "revisar" ? "savebtn" : undefined} onClick={name === "revisar" ? () => { void sign() } : next} disabled={footDisabled}>{returning ? "Volver a revisar" : footLabel}</button>
      </div>
      {confirmExit ? (
        <SaveOrDiscardDialog
          title="¿Salir del registro?"
          saveLabel="Guardar y salir"
          keepLabel="Seguir registrando"
          discardLabel="Descartar registro"
          busy={exiting}
          error={exitError ?? undefined}
          onSave={() => { void saveAndExit() }}
          onKeep={closeExit}
          onDiscard={() => { closeExit(); void discardAndExit() }}
        >
          <p>Tu avance queda guardado en este teléfono. Lo retomas desde el inicio, en «{draft.kind === "P" ? "Preventiva" : "Correctiva"} sin terminar».</p>
        </SaveOrDiscardDialog>
      ) : null}
    </div>
  )
}
