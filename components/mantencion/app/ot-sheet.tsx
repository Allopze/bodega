"use client"

import { useState, type ReactNode } from "react"
import { formatReading } from "@/lib/mantencion/format"
import { isFuture, nowLocalMax, nowLocalValue } from "@/lib/mantencion/client/ot-time"
import { discardRejectedOtOp } from "@/lib/mantencion/client/queue"
import { equipmentLabel } from "@/lib/mantencion/client/fleet-view"
import type { OtView } from "@/lib/mantencion/client/ot-model"
import { OT_ITEM_KIND_LABELS, OT_STATUS_LABELS, type OtItemKind } from "@/lib/mantencion/work-order-states"
import type { WorkOrderOpAction } from "@/lib/mantencion/contracts"
import { formatDate, formatDateTime, toLocalInputValue, todayInChile } from "@/lib/utils"
import { useAppData } from "./app-context"
import { Sheet } from "./dialog"
import { OtEntryForm } from "./ot-entry-form"
import { OtItemsEditor } from "./ot-items"
import { otKindText } from "./ot-lists"
import { useOtOp, type OtOpBody } from "./use-ot-op"
import { Banner, FieldError, Label } from "./ui"

type Mode = "main" | "entry" | "estimate" | "items" | "finish"

const ACTION_LABEL: Record<WorkOrderOpAction, string> = {
  take: "Tomar la OT",
  start: "Ingreso a taller",
  estimate: "Fecha estimada de entrega",
  items: "Marcas de ítems",
  finish: "Terminar",
}
const TITLES: Record<Mode, string | null> = { main: null, entry: "Ingreso a taller", estimate: "Fecha de entrega", items: "Ítems de la OT", finish: "Terminar la OT" }

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd><span>{children}</span></dd>
    </>
  )
}

function doneText(done: "si" | "no" | null): string {
  return done === "si" ? "SÍ" : done === "no" ? "NO" : "Sin marcar"
}

/** Cambiar la fecha estimada de entrega: el motivo es obligatorio, queda en el historial de la OT. */
function EstimateForm({ view, saving, error, onSubmit, onBack }: { view: OtView; saving: boolean; error: string | null; onSubmit: (body: OtOpBody) => void; onBack: () => void }) {
  const current = view.ot.entry?.estimatedDeliveryDate ?? ""
  const entryDay = view.ot.entry ? todayInChile(new Date(view.ot.entry.entryAt)) : undefined
  const [date, setDate] = useState(current)
  const [reason, setReason] = useState("")
  const [errors, setErrors] = useState<{ date?: string; reason?: string }>({})

  const submit = () => {
    const next: typeof errors = {}
    if (!date) next.date = "Indica la nueva fecha."
    else if (date === current) next.date = "Elige una fecha distinta a la actual."
    else if (entryDay && date < entryDay) next.date = "La entrega no puede ser antes del ingreso."
    if (reason.trim().length < 5) next.reason = "Cuenta por qué cambia la fecha."
    setErrors(next)
    if (Object.keys(next).length === 0) onSubmit({ action: "estimate", estimatedDeliveryDate: date, reason: reason.trim() })
  }
  return (
    <>
      <p className="hint" style={{ marginTop: 0 }}>Fecha actual: <strong>{current ? formatDate(current) : "sin fecha"}</strong></p>
      <div>
        <Label htmlFor="ot-nueva-fecha">Nueva fecha estimada de entrega</Label>
        <input id="ot-nueva-fecha" type="date" className={errors.date ? "inp bad" : "inp"} value={date} min={entryDay} aria-invalid={Boolean(errors.date)} onChange={(event) => { setDate(event.target.value); setErrors({}) }} />
        <FieldError message={errors.date} />
      </div>
      <div>
        <Label htmlFor="ot-motivo-fecha">Motivo del cambio</Label>
        <textarea id="ot-motivo-fecha" className={errors.reason ? "inp bad" : "inp"} rows={3} maxLength={500} value={reason} placeholder="Ej: espera un repuesto importado" aria-invalid={Boolean(errors.reason)} onChange={(event) => { setReason(event.target.value); setErrors({}) }} />
        <FieldError message={errors.reason} />
      </div>
      <FieldError message={error ?? undefined} />
      <button type="button" className="btnp" onClick={submit} disabled={saving}>Guardar fecha</button>
      <button type="button" className="btns wide" onClick={onBack} disabled={saving}>Volver</button>
    </>
  )
}

/** «Terminar» = salida de taller: fecha y hora. Dice qué falta antes de poder terminar. */
function FinishForm({ view, saving, error, onSubmit, onBack }: { view: OtView; saving: boolean; error: string | null; onSubmit: (body: OtOpBody) => void; onBack: () => void }) {
  const [exitAt, setExitAt] = useState(nowLocalValue)
  const [note, setNote] = useState("")
  const [problem, setProblem] = useState<string | null>(null)
  const entryAt = view.ot.entry ? new Date(view.ot.entry.entryAt) : null

  const submit = () => {
    if (view.finishBlockers.length > 0) { setProblem(`Todavía no puedes terminarla: ${view.finishBlockers[0]?.toLowerCase()}.`); return }
    const when = exitAt ? new Date(exitAt) : null
    if (!when || Number.isNaN(when.getTime())) { setProblem("Indica la fecha y la hora de salida."); return }
    if (isFuture(when)) { setProblem("La salida no puede ser en el futuro."); return }
    if (entryAt && when.getTime() < entryAt.getTime()) { setProblem(`La salida no puede ser antes del ingreso (${formatDateTime(entryAt)}).`); return }
    onSubmit({ action: "finish", exitAt: when.toISOString(), note: note.trim() || null })
  }
  return (
    <>
      {view.finishBlockers.length > 0 ? (
        <Banner>
          <strong>Antes de terminar</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>{view.finishBlockers.map((text) => <li key={text} style={{ display: "list-item", listStyle: "disc" }}>{text}</li>)}</ul>
        </Banner>
      ) : <p className="hint" style={{ marginTop: 0 }}>Todo listo: ítems marcados y trabajo registrado.</p>}
      <div>
        <Label htmlFor="ot-salida">Fecha y hora de salida de taller</Label>
        <input id="ot-salida" type="datetime-local" className="inp" value={exitAt} min={entryAt ? toLocalInputValue(entryAt) : undefined} max={nowLocalMax()} onChange={(event) => { setExitAt(event.target.value); setProblem(null) }} />
      </div>
      <div>
        <Label htmlFor="ot-nota-salida" hint="opcional">Nota</Label>
        <textarea id="ot-nota-salida" className="inp" rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
      </div>
      <FieldError message={problem ?? error ?? undefined} />
      <button type="button" className="btnp" onClick={submit} disabled={saving}>Terminar y avisar</button>
      <button type="button" className="btns wide" onClick={onBack} disabled={saving}>Volver</button>
    </>
  )
}

/**
 * Una OT en la mano del mecánico. Lo que puede hacer depende del estado
 * (`view.flags`, las mismas guardias del servidor): tomarla, registrar el
 * ingreso a taller, marcar los ítems, cambiar la fecha de entrega, registrar el
 * trabajo con la correctiva o preventiva de siempre, y terminar. Todo se guarda
 * en el teléfono y se envía solo; sin confirmaciones en lo rutinario.
 */
export function OtSheet({ view, onClose, onRegister, onHistory }: {
  view: OtView
  onClose: () => void
  onRegister: (kind: "P" | "C", view: OtView) => void
  /** Abre el historial del equipo de la OT (quien lo pasa cierra la OT y la reabre al volver). */
  onHistory?: (vehicleId: string) => void
}) {
  const [mode, setMode] = useState<Mode>("main")
  const { ot, flags } = view
  const op = useOtOp(view)
  const { account } = useAppData()

  const run = async (body: OtOpBody, done: string, next: Mode = "main") => {
    if (await op.submit(body, done)) setMode(next)
  }
  const go = (next: Mode) => { op.setError(null); setMode(next) }
  const title = TITLES[mode] ?? ot.folio
  const eq = equipmentLabel({ code: ot.equipmentCode, plate: ot.equipmentPlate })
  const mine = ot.assignedToUserId === account.userId
  const entry = ot.entry
  const meter = entry?.odometer != null ? formatReading(entry.odometer, "km") : entry?.hourmeter != null ? formatReading(entry.hourmeter, "h") : null

  return (
    <Sheet title={title} onClose={onClose} stable>
      {mode === "entry" ? <OtEntryForm view={view} saving={op.saving} error={op.error} onSubmit={(body) => { void run(body, "Ingreso registrado.") }} onBack={() => go("main")} /> : null}
      {mode === "estimate" ? <EstimateForm view={view} saving={op.saving} error={op.error} onSubmit={(body) => { void run(body, "Fecha de entrega actualizada.") }} onBack={() => go("main")} /> : null}
      {mode === "items" ? <OtItemsEditor view={view} saving={op.saving} error={op.error} onSubmit={(body) => { void run(body, "Ítems guardados.") }} onBack={() => go("main")} /> : null}
      {mode === "finish" ? <FinishForm view={view} saving={op.saving} error={op.error} onSubmit={(body) => { void run(body, "OT terminada.") }} onBack={() => go("main")} /> : null}
      {mode === "main" ? (
        <>
          <div>
            <div className="mono" style={{ fontWeight: 600 }}>{eq}</div>
            <p className="hint">{OT_STATUS_LABELS[ot.status]}{ot.assignedToName && !mine ? ` · ${ot.assignedToName}` : ""}{view.pending ? " · hay cambios sin enviar" : ""}</p>
            {onHistory ? <button type="button" className="lnk" style={{ marginTop: 4 }} onClick={() => onHistory(ot.vehicleId)}>Historial del equipo</button> : null}
            {ot.outOfWorksite ? <p className="hint">Equipo de otra faena ({ot.worksiteName}). Puedes trabajarla igual.</p> : null}
          </div>
          {view.returnedReason ? <Banner><strong>Devuelta: {view.returnedReason}</strong><div>Corrige lo que falta, registra el trabajo de nuevo y termina otra vez.</div></Banner> : null}
          {view.rejected.map((rejected) => (
            <Banner key={rejected.id} action={<button type="button" className="lnk" onClick={() => { void discardRejectedOtOp(rejected.id) }}>Entendido</button>}>
              <strong>No se pudo enviar: {ACTION_LABEL[rejected.action]}</strong>
              <div>{rejected.message}</div>
            </Banner>
          ))}

          <dl className="dl">
            <Row label="Tipo">{otKindText(ot)}</Row>
            <Row label="Solicitó">{ot.requesterName} · {formatDate(ot.requestDate)}</Row>
            {ot.repairDescription ? <Row label="Reparación">{ot.repairDescription}</Row> : null}
            {ot.observations ? <Row label="Observaciones">{ot.observations}</Row> : null}
            {entry ? (
              <>
                <Row label="Taller">{entry.workshopKind === "interno" ? "Interno" : "Externo"}{entry.workshopName ? ` · ${entry.workshopName}` : ""}</Row>
                {entry.workshopManagerName ? <Row label="Encargado">{entry.workshopManagerName}</Row> : null}
                {entry.operatorName ? <Row label="Operador">{entry.operatorName}</Row> : null}
                <Row label="Ingreso">{formatDateTime(entry.entryAt)}</Row>
                {meter ? <Row label={entry.odometer != null ? "Odómetro" : "Horómetro"}><span className="mono">{meter}</span></Row> : null}
                <Row label="Entrega estimada">{formatDate(entry.estimatedDeliveryDate)}</Row>
              </>
            ) : null}
            {ot.exitAt ? <Row label="Salida taller">{formatDateTime(ot.exitAt)}</Row> : null}
          </dl>

          {ot.items.length > 0 ? (
            <div className="card">
              <div className="cap" style={{ marginBottom: 8 }}>Ítems pedidos{flags.canWork ? ` · ${view.unmarked === 0 ? "todos marcados" : `${view.unmarked} sin marcar`}` : ""}</div>
              {(["anexo", "mantencion"] as OtItemKind[]).map((kind) => {
                const items = ot.items.filter((item) => item.kind === kind)
                if (items.length === 0) return null
                return (
                  <div key={kind} style={{ marginTop: 6 }}>
                    <div className="hint" style={{ marginTop: 0 }}>{OT_ITEM_KIND_LABELS[kind]}</div>
                    <ul style={{ margin: "4px 0 0", padding: 0, listStyle: "none" }}>
                      {items.map((item) => (
                        <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "4px 0", fontSize: 16 }}>
                          <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{item.description}</span>
                          <strong style={{ flexShrink: 0 }}>{doneText(item.done)}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          ) : null}

          {view.linked.length > 0 ? (
            <div className="card">
              <div className="cap" style={{ marginBottom: 8 }}>Trabajo registrado</div>
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {view.linked.map((record) => (
                  <li key={record.id} style={{ padding: "3px 0", fontSize: 16 }}>
                    {record.kind === "P" ? "Preventiva" : "Correctiva"} · <span className="mono nw" style={{ fontSize: 14 }}>{record.folio ?? "Folio pendiente"}</span>{record.pending ? " · sin enviar" : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {flags.canTake ? <button type="button" className="btnp" disabled={op.saving} onClick={() => { void run({ action: "take" }, "Tomaste la OT. Quedó en «Mis OT».") }}>Tomar esta OT</button> : null}
          {flags.canStart ? <button type="button" className="btnp" onClick={() => go("entry")}>Registrar ingreso a taller</button> : null}
          {flags.canWork ? (
            <>
              <div className="cap">Registrar el trabajo</div>
              <button type="button" className="btns wide" onClick={() => onRegister("C", view)}>Registrar correctiva</button>
              <button type="button" className="btns wide" onClick={() => onRegister("P", view)}>Registrar preventiva</button>
              <button type="button" className="btns wide" onClick={() => go("items")}>Marcar ítems SÍ / NO{view.unmarked > 0 ? ` (${view.unmarked})` : ""}</button>
              <button type="button" className="btns wide" onClick={() => go("estimate")}>Cambiar fecha de entrega</button>
              <button type="button" className="btnp" onClick={() => go("finish")}>Terminar (salida de taller)</button>
            </>
          ) : null}
          <FieldError message={op.error ?? undefined} />
          <button type="button" className="btns wide" onClick={onClose}>Cerrar</button>
        </>
      ) : null}
    </Sheet>
  )
}
