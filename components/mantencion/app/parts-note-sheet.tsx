"use client"

import { useId, useMemo, useRef, useState, type RefObject } from "react"
import { MANT_PARTS_NOTE_MAX_LINES, partsNoteSchema } from "@/lib/mantencion/contracts"
import { StorageFullError } from "@/lib/mantencion/client/db"
import { equipmentLabel } from "@/lib/mantencion/client/fleet-view"
import type { OtView } from "@/lib/mantencion/client/ot-model"
import { chargeChoices, chargeStillValid, NO_CHARGE, partsNoteInput, requestWorksites } from "@/lib/mantencion/client/parts-request-model"
import { enqueueSimple, newPartsNoteItem } from "@/lib/mantencion/client/queue"
import { buildSparePartIndex, catalogSpareParts } from "@/lib/mantencion/client/spare-part-search"
import { useAppActions, useAppData } from "./app-context"
import { Sheet, useSheetDirty, useSheetGuard } from "./dialog"
import { blankLine, errorsFrom, LineCard, linesDirty, quantityOf, type FormErrors, type LineState } from "./parts-note-form"
import { FieldError, Label } from "./ui"

/**
 * El pedido de repuestos del mecánico, con OT (`view`: desde su orden de trabajo) o SIN OT (desde el inicio de la app:
 * pedido de taller o de reposición, a una faena suya y con cargo opcional por línea). Se valida con el MISMO esquema del
 * servidor antes de encolar: lo que no pasa aquí no se guarda como «pendiente» para que el servidor lo rechace horas
 * después. Se encola igual que siempre (sin señal también), con su id: el mismo en cada reintento.
 */

type Worksite = { id: string; name: string }

function PartsNoteForm({ view, firstRef, onClose, onSaved }: { view: OtView | null; firstRef: RefObject<HTMLInputElement | null>; onClose: () => void; onSaved: () => void }) {
  const { account, deviceId, appVersion, stored } = useAppData()
  const { syncNow } = useAppActions()
  const { confirmThen } = useSheetGuard()
  const catalog = stored?.catalog
  const ot = view?.ot ?? null
  const sites = useMemo(() => requestWorksites(catalog), [catalog])
  // El catálogo de repuestos se normaliza una vez; sin él (catálogo antiguo o sin permiso) la línea es sólo texto libre.
  const parts = useMemo(() => { const list = catalogSpareParts(catalog); return list.length > 0 ? buildSparePartIndex(list) : null }, [catalog])
  const nextKey = useRef(2)
  const [lines, setLines] = useState<LineState[]>(() => [blankLine(1)])
  const [focusKey, setFocusKey] = useState<number | null>(null)
  const [worksiteId, setWorksiteId] = useState(() => (!ot && sites.length === 1 ? sites[0]!.id : ""))
  const [stopped, setStopped] = useState(false)
  const [urgent, setUrgent] = useState(false)
  const [notes, setNotes] = useState("")
  const [errors, setErrors] = useState<FormErrors>({ lines: {} })
  const [saving, setSaving] = useState(false)
  const flagId = useId()
  const notesId = useId()
  const siteId = useId()
  const full = lines.length >= MANT_PARTS_NOTE_MAX_LINES
  const charges = useMemo(() => (ot ? null : chargeChoices(catalog, worksiteId)), [ot, catalog, worksiteId])
  const site = sites.find((entry) => entry.id === worksiteId) ?? null
  const flagged = ot ? stopped : urgent

  useSheetDirty(linesDirty(lines) || stopped || urgent || notes.trim() !== "")

  const change = (key: number, patch: Partial<LineState>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
    setErrors((current) => (Object.keys(current.lines).length === 0 && !current.general ? current : { ...current, lines: { ...current.lines, [key]: {} } }))
  }

  /** Al cambiar de faena, los cargos de la anterior (equipos y centros que no son de ésta) se sueltan. */
  const chooseWorksite = (id: string) => {
    const next = chargeChoices(catalog, id)
    setWorksiteId(id)
    setLines((current) => current.map((line) => (chargeStillValid(line.charge, next) ? line : { ...line, charge: NO_CHARGE })))
    setErrors((current) => ({ ...current, worksite: undefined }))
  }

  const submit = async () => {
    const parsed = partsNoteSchema.safeParse(partsNoteInput({
      id: crypto.randomUUID(), deviceId, appVersion, createdAt: new Date().toISOString(),
      workOrderId: ot?.id ?? null, worksiteId, equipmentStopped: ot ? stopped : false, urgent, notes,
      lines: lines.map((line) => ({ description: line.description, quantity: quantityOf(line), partNumber: line.partNumber, charge: line.charge, productId: line.productId, unit: line.unit })),
    }))
    const found: FormErrors = parsed.success ? { lines: {} } : errorsFrom(parsed.error.issues, lines)
    if (!ot && !site) found.worksite = "Elige la faena a la que pides los repuestos."
    if (!parsed.success || found.worksite) { setErrors(found); return }
    setErrors({ lines: {} })
    setSaving(true)
    try {
      await enqueueSimple(newPartsNoteItem({
        authorUserId: account.userId,
        payload: parsed.data,
        summary: ot
          ? { workOrderId: ot.id, folio: ot.folio, equipmentCode: ot.equipmentCode, equipmentPlate: ot.equipmentPlate }
          : { workOrderId: null, folio: null, equipmentCode: null, equipmentPlate: null, worksiteName: site?.name ?? null },
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
      {ot ? (
        <p className="hint" style={{ margin: 0 }}>Para <strong>{equipmentLabel({ code: ot.equipmentCode, plate: ot.equipmentPlate })}</strong> · <span className="mono nw">{ot.folio}</span></p>
      ) : sites.length === 1 ? (
        <p className="hint" style={{ margin: 0 }}>Para la faena <strong>{sites[0]!.name}</strong> · sin orden de trabajo</p>
      ) : (
        <WorksiteSelect id={siteId} sites={sites} value={worksiteId} error={errors.worksite} onChange={chooseWorksite} />
      )}
      {lines.map((line, index) => (
        <LineCard key={line.key} line={line} number={index + 1} errors={errors.lines[line.key]} removable={lines.length > 1} firstRef={index === 0 ? firstRef : null} focusNow={line.key === focusKey} charges={charges} parts={parts}
          onChange={(patch) => change(line.key, patch)} onRemove={() => setLines((current) => current.filter((entry) => entry.key !== line.key))} />
      ))}
      <button type="button" className="btns wide" style={{ borderStyle: "dashed" }} disabled={full}
        onClick={() => { const key = nextKey.current++; setLines((current) => [...current, blankLine(key, current[current.length - 1]?.charge)]); setFocusKey(key) }}>+ Otro repuesto</button>
      {full ? <p className="hint" style={{ margin: 0 }}>Máximo {MANT_PARTS_NOTE_MAX_LINES} repuestos por pedido.</p> : null}

      <div>
        <label className="check" htmlFor={flagId}>
          <input id={flagId} type="checkbox" role="switch" checked={flagged} onChange={(event) => (ot ? setStopped(event.target.checked) : setUrgent(event.target.checked))} />
          <span>{ot ? "El equipo está detenido esperando esto" : "Es urgente"}</span>
        </label>
        {flagged ? <p className="hint">Se avisará como urgente.</p> : null}
      </div>
      <div>
        <Label htmlFor={notesId} size="sm" hint="opcional">{ot ? "Comentario" : "Observación"}</Label>
        <textarea id={notesId} className="inp" rows={2} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>

      <FieldError message={errors.general} />
      <button type="button" className="btnp" onClick={() => { void submit() }} disabled={saving}>Enviar pedido</button>
      <button type="button" className="btns wide" onClick={() => confirmThen(onClose)} disabled={saving}>Cancelar</button>
    </>
  )
}

/** «Faena»: con varias faenas se elige una a propósito (no hay una por omisión que se pueda pedir por error). */
function WorksiteSelect({ id, sites, value, error, onChange }: { id: string; sites: Worksite[]; value: string; error: string | undefined; onChange: (id: string) => void }) {
  const errId = useId()
  return (
    <div>
      <Label htmlFor={id} size="sm">Faena</Label>
      <select id={id} className={error ? "inp bad" : "inp"} value={value} aria-invalid={Boolean(error)} aria-describedby={error ? errId : undefined} onChange={(event) => onChange(event.target.value)}>
        <option value="">Elige la faena</option>
        {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
      </select>
      <FieldError message={error} id={errId} />
    </div>
  )
}

/**
 * «Pedir repuestos»: una hoja de alto fijo, con guarda de cambios sin guardar. `onSaved` lo llama al dejar el pedido en la
 * cola. Con `view` es el pedido de esa OT; sin él, el pedido sin OT del inicio.
 */
export function PartsNoteSheet({ view = null, onClose, onSaved }: { view?: OtView | null; onClose: () => void; onSaved: () => void }) {
  const first = useRef<HTMLInputElement>(null)
  return (
    <Sheet title="Pedir repuestos" onClose={onClose} initialFocus={first} stable>
      <PartsNoteForm view={view} firstRef={first} onClose={onClose} onSaved={onSaved} />
    </Sheet>
  )
}
