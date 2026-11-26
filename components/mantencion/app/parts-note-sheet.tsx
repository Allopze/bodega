"use client"

import { useEffect, useId, useRef, useState, type RefObject } from "react"
import { MANT_PARTS_NOTE_MAX_LINES, partsNoteSchema } from "@/lib/mantencion/contracts"
import { StorageFullError } from "@/lib/mantencion/client/db"
import { equipmentLabel } from "@/lib/mantencion/client/fleet-view"
import type { OtView } from "@/lib/mantencion/client/ot-model"
import { enqueueSimple, newPartsNoteItem } from "@/lib/mantencion/client/queue"
import { useAppActions, useAppData } from "./app-context"
import { Sheet, useSheetDirty, useSheetGuard } from "./dialog"
import { IconClose } from "./icons"
import { FieldError, Label } from "./ui"

/** Una línea del pedido tal como se escribe: todo texto, hasta que se valida con el esquema del servidor. */
interface LineState { key: number; quantity: string; description: string; partNumber: string; partOpen: boolean }
interface LineErrors { description?: string; quantity?: string }
interface FormErrors { lines: Record<number, LineErrors>; general?: string }

const QUANTITY_MAX_DIGITS = 6
const blankLine = (key: number): LineState => ({ key, quantity: "1", description: "", partNumber: "", partOpen: false })
const quantityOf = (line: LineState): number => Number(line.quantity || "0")

/** Los errores del esquema, cada uno junto al campo que corresponde; lo que no es de una línea va al pie. */
function errorsFrom(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string; code: string }>, lines: readonly LineState[]): FormErrors {
  const errors: FormErrors = { lines: {} }
  for (const issue of issues) {
    const [root, index, field] = issue.path
    const line = root === "lines" && typeof index === "number" ? lines[index] : undefined
    if (line && (field === "description" || field === "quantity")) {
      const message = issue.code === "too_big" ? (field === "quantity" ? "La cantidad es demasiado grande." : "El nombre del repuesto es muy largo.") : issue.message
      errors.lines[line.key] = { ...errors.lines[line.key], [field]: errors.lines[line.key]?.[field] ?? message }
    } else errors.general ??= root === "lines" && issue.code !== "too_big" ? issue.message : "Revisa los datos del pedido."
  }
  return errors
}

function Quantity({ line, number, onChange }: { line: LineState; number: number; onChange: (text: string) => void }) {
  const id = useId()
  const value = quantityOf(line)
  const set = (next: number) => onChange(String(Math.min(10 ** QUANTITY_MAX_DIGITS - 1, Math.max(1, next))))
  return (
    <div>
      <Label htmlFor={id} size="sm">Cantidad</Label>
      <div className="stepper" style={{ width: "fit-content" }}>
        <button type="button" aria-label={`Restar uno al repuesto ${number}`} disabled={value <= 1} onClick={() => set(value - 1)}>−</button>
        <input id={id} className="stq" inputMode="numeric" pattern="[0-9]*" autoComplete="off" value={line.quantity} aria-invalid={value < 1}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, QUANTITY_MAX_DIGITS))}
          onBlur={() => { if (value < 1) onChange("1"); else if (String(value) !== line.quantity) onChange(String(value)) }} />
        <button type="button" aria-label={`Sumar uno al repuesto ${number}`} onClick={() => set(value + 1)}>+</button>
      </div>
    </div>
  )
}

function LineCard({ line, number, errors, removable, firstRef, focusNow, onChange, onRemove }: {
  line: LineState; number: number; errors: LineErrors | undefined; removable: boolean; firstRef: RefObject<HTMLInputElement | null> | null
  /** Una línea recién agregada recibe el foco: el teclado sube y la hoja la trae a la vista. */
  focusNow: boolean
  onChange: (change: Partial<LineState>) => void; onRemove: () => void
}) {
  const head = useId()
  const descId = useId()
  const partId = useId()
  const errId = useId()
  const own = useRef<HTMLInputElement | null>(null)
  useEffect(() => { if (focusNow) own.current?.focus() }, [focusNow])
  return (
    <div className="card pline" role="group" aria-labelledby={head}>
      <div className="plhead">
        <strong id={head}>Repuesto {number}</strong>
        {removable ? <button type="button" className="ibtn sm" aria-label={`Quitar el repuesto ${number}`} onClick={onRemove}><IconClose /></button> : null}
      </div>
      <Quantity line={line} number={number} onChange={(quantity) => onChange({ quantity })} />
      {errors?.quantity ? <FieldError message={errors.quantity} /> : null}
      <div>
        <Label htmlFor={descId} size="sm">¿Qué repuesto necesitas?</Label>
        <input id={descId} ref={(node) => { own.current = node; if (firstRef) firstRef.current = node }} className={errors?.description ? "inp bad" : "inp"} value={line.description} maxLength={300} autoComplete="off" placeholder="Ej: Filtro de aceite"
          aria-invalid={Boolean(errors?.description)} aria-describedby={errors?.description ? errId : undefined}
          onChange={(event) => onChange({ description: event.target.value })} />
        <FieldError message={errors?.description} id={errId} />
      </div>
      {line.partOpen || line.partNumber ? (
        <div>
          <Label htmlFor={partId} size="sm">N° de parte (opcional)</Label>
          <input id={partId} className="inp sm" value={line.partNumber} maxLength={80} autoComplete="off" onChange={(event) => onChange({ partNumber: event.target.value })} />
        </div>
      ) : (
        <button type="button" className="lnk" onClick={() => { onChange({ partOpen: true }); requestAnimationFrame(() => document.getElementById(partId)?.focus()) }}>+ N° de parte (opcional)</button>
      )}
    </div>
  )
}

/**
 * El pedido de repuestos del mecánico para su OT. Se valida con el MISMO esquema del servidor antes de encolar:
 * lo que no pasa aquí no se guarda como «pendiente» para que el servidor lo rechace horas después.
 */
function PartsNoteForm({ view, firstRef, onClose, onSaved }: { view: OtView; firstRef: RefObject<HTMLInputElement | null>; onClose: () => void; onSaved: () => void }) {
  const { account, deviceId, appVersion } = useAppData()
  const { syncNow } = useAppActions()
  const { confirmThen } = useSheetGuard()
  const nextKey = useRef(2)
  const [lines, setLines] = useState<LineState[]>(() => [blankLine(1)])
  const [focusKey, setFocusKey] = useState<number | null>(null)
  const [stopped, setStopped] = useState(false)
  const [notes, setNotes] = useState("")
  const [errors, setErrors] = useState<FormErrors>({ lines: {} })
  const [saving, setSaving] = useState(false)
  const stoppedId = useId()
  const notesId = useId()
  const { ot } = view
  const full = lines.length >= MANT_PARTS_NOTE_MAX_LINES

  useSheetDirty(lines.length > 1 || lines.some((line) => line.description.trim() !== "" || line.partNumber.trim() !== "" || line.quantity !== "1") || stopped || notes.trim() !== "")

  const change = (key: number, patch: Partial<LineState>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
    setErrors((current) => (Object.keys(current.lines).length === 0 && !current.general ? current : { lines: { ...current.lines, [key]: {} } }))
  }

  const submit = async () => {
    const parsed = partsNoteSchema.safeParse({
      id: crypto.randomUUID(), workOrderId: ot.id, deviceId, appVersion: appVersion.slice(0, 40), createdAt: new Date().toISOString(),
      equipmentStopped: stopped, notes: notes.trim() || null,
      lines: lines.map((line) => ({ description: line.description, quantity: quantityOf(line), unitOfMeasure: "unidad", partNumber: line.partNumber.trim() || null, productId: null })),
    })
    if (!parsed.success) { setErrors(errorsFrom(parsed.error.issues, lines)); return }
    setErrors({ lines: {} })
    setSaving(true)
    try {
      await enqueueSimple(newPartsNoteItem({
        authorUserId: account.userId,
        payload: parsed.data,
        summary: { workOrderId: ot.id, folio: ot.folio, equipmentCode: ot.equipmentCode, equipmentPlate: ot.equipmentPlate },
      }, parsed.data.id))
      syncNow()
      onSaved()
    } catch (cause) {
      setErrors({ lines: {}, general: cause instanceof StorageFullError ? cause.message : "No pudimos guardar el pedido. Intenta de nuevo." })
      setSaving(false)
    }
  }

  return (
    <>
      <p className="hint" style={{ margin: 0 }}>Para <strong>{equipmentLabel({ code: ot.equipmentCode, plate: ot.equipmentPlate })}</strong> · <span className="mono nw">{ot.folio}</span></p>
      {lines.map((line, index) => (
        <LineCard key={line.key} line={line} number={index + 1} errors={errors.lines[line.key]} removable={lines.length > 1} firstRef={index === 0 ? firstRef : null} focusNow={line.key === focusKey}
          onChange={(patch) => change(line.key, patch)} onRemove={() => setLines((current) => current.filter((entry) => entry.key !== line.key))} />
      ))}
      <button type="button" className="btns wide" style={{ borderStyle: "dashed" }} disabled={full}
        onClick={() => { const key = nextKey.current++; setLines((current) => [...current, blankLine(key)]); setFocusKey(key) }}>+ Otro repuesto</button>
      {full ? <p className="hint" style={{ margin: 0 }}>Máximo {MANT_PARTS_NOTE_MAX_LINES} repuestos por pedido.</p> : null}

      <div>
        <label className="check" htmlFor={stoppedId}>
          <input id={stoppedId} type="checkbox" role="switch" checked={stopped} onChange={(event) => setStopped(event.target.checked)} />
          <span>El equipo está detenido esperando esto</span>
        </label>
        {stopped ? <p className="hint">Se avisará como urgente.</p> : null}
      </div>
      <div>
        <Label htmlFor={notesId} size="sm" hint="opcional">Comentario</Label>
        <textarea id={notesId} className="inp" rows={2} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>

      <FieldError message={errors.general} />
      <button type="button" className="btnp" onClick={() => { void submit() }} disabled={saving}>Enviar pedido</button>
      <button type="button" className="btns wide" onClick={() => confirmThen(onClose)} disabled={saving}>Cancelar</button>
    </>
  )
}

/** «Pedir repuestos»: una hoja de alto fijo, con guarda de cambios sin guardar. `onSaved` lo llama al dejar el pedido en la cola. */
export function PartsNoteSheet({ view, onClose, onSaved }: { view: OtView; onClose: () => void; onSaved: () => void }) {
  const first = useRef<HTMLInputElement>(null)
  return (
    <Sheet title="Pedir repuestos" onClose={onClose} initialFocus={first} stable>
      <PartsNoteForm view={view} firstRef={first} onClose={onClose} onSaved={onSaved} />
    </Sheet>
  )
}
