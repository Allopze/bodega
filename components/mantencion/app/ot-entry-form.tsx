"use client"

import { useState } from "react"
import { workOrderEntrySchema } from "@/lib/mantencion/contracts"
import { formatReading, meterName, parseReadingInput } from "@/lib/mantencion/format"
import { checkReading } from "@/lib/mantencion/readings"
import type { OtView } from "@/lib/mantencion/client/ot-model"
import { isFuture, nowLocalMax, nowLocalValue } from "@/lib/mantencion/client/ot-time"
import { todayInChile } from "@/lib/utils"
import { useAppData } from "./app-context"
import type { OtOpBody } from "./use-ot-op"
import { FieldError, Label } from "./ui"

const OTHER = "__otro__"

type Errors = Partial<Record<"kind" | "workshop" | "entryAt" | "reading" | "estimate", string>>

/**
 * «Ingreso a taller», como en el talonario: taller (interno o externo), encargado,
 * operador, fecha y hora de ingreso, lectura del equipo y fecha estimada de entrega.
 * Con la lectura en la unidad del equipo (odómetro o horómetro).
 */
export function OtEntryForm({ view, saving, error, onSubmit, onBack }: {
  view: OtView
  saving: boolean
  error: string | null
  onSubmit: (body: OtOpBody) => void
  onBack: () => void
}) {
  const { stored, rows } = useAppData()
  const catalog = stored?.catalog
  const { ot } = view
  const row = rows.find((entry) => entry.eq.id === ot.vehicleId) ?? null
  const [kind, setKind] = useState<"interno" | "externo" | null>(null)
  const [workshopId, setWorkshopId] = useState("")
  const [manager, setManager] = useState("")
  const [operator, setOperator] = useState("")
  const [operatorName, setOperatorName] = useState("")
  const [entryAt, setEntryAt] = useState(nowLocalValue)
  const [readingText, setReadingText] = useState("")
  const [estimate, setEstimate] = useState("")
  const [errors, setErrors] = useState<Errors>({})

  const last = row?.status.currentReading ?? null
  const entryDay = entryAt ? todayInChile(new Date(entryAt)) : null

  const submit = () => {
    const next: Errors = {}
    if (!kind) next.kind = "Elige si es taller interno o externo."
    if (kind === "externo" && !workshopId) next.workshop = "Elige el taller externo."
    const when = entryAt ? new Date(entryAt) : null
    if (!when || Number.isNaN(when.getTime())) next.entryAt = "Indica la fecha y la hora de ingreso."
    else if (isFuture(when)) next.entryAt = "El ingreso no puede ser en el futuro."
    const reading = parseReadingInput(readingText).value
    if (reading === null) next.reading = `Ingresa la lectura del ${meterName(ot.unit)}.`
    else if (row && when && !Number.isNaN(when.getTime())) {
      const check = checkReading({ value: reading, workDate: todayInChile(when), unit: ot.unit, readings: row.readings, initial: row.initial })
      if (!check.ok) next.reading = check.message
    }
    if (!estimate) next.estimate = "Indica la fecha estimada de entrega."
    else if (entryDay && estimate < entryDay) next.estimate = "La entrega no puede ser antes del ingreso."
    setErrors(next)
    if (Object.keys(next).length > 0 || !kind || !when || reading === null) return

    const candidate = {
      workshopKind: kind,
      workshopId: kind === "externo" ? workshopId : null,
      workshopManagerName: manager.trim() || null,
      operatorDriverId: operator && operator !== OTHER ? operator : null,
      operatorName: operator === OTHER ? operatorName.trim() || null : null,
      entryAt: when.toISOString(),
      odometer: ot.unit === "km" ? reading : null,
      hourmeter: ot.unit === "km" ? null : reading,
      estimatedDeliveryDate: estimate,
    }
    const parsed = workOrderEntrySchema.safeParse(candidate)
    if (!parsed.success) { setErrors({ reading: parsed.error.issues[0]?.message ?? "Revisa los datos." }); return }
    onSubmit({ action: "start", entry: parsed.data })
  }

  const meter = meterName(ot.unit)
  return (
    <>
      <div>
        <div className="lbl" id="ot-kind">Taller</div>
        <div className="seg" role="group" aria-labelledby="ot-kind" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <button type="button" aria-pressed={kind === "interno"} onClick={() => { setKind("interno"); setErrors({}) }}>Interno</button>
          <button type="button" aria-pressed={kind === "externo"} onClick={() => { setKind("externo"); setErrors({}) }}>Externo</button>
        </div>
        <FieldError message={errors.kind} />
      </div>
      {kind === "externo" ? (
        <div>
          <Label htmlFor="ot-taller">Taller externo</Label>
          <select id="ot-taller" className={errors.workshop ? "inp bad" : "inp"} value={workshopId} aria-invalid={Boolean(errors.workshop)} onChange={(event) => { setWorkshopId(event.target.value); setErrors({}) }}>
            <option value="">Elige…</option>
            {(catalog?.workshops ?? []).map((workshop) => <option key={workshop.id} value={workshop.id}>{workshop.name}</option>)}
          </select>
          <FieldError message={errors.workshop} />
        </div>
      ) : null}
      <div>
        <Label htmlFor="ot-encargado" hint="si lo sabes">Encargado del taller</Label>
        <input id="ot-encargado" className="inp" value={manager} maxLength={120} autoComplete="off" onChange={(event) => setManager(event.target.value)} />
      </div>
      <div>
        <Label htmlFor="ot-operador" hint="quien trae el equipo">Operador</Label>
        <select id="ot-operador" className="inp" value={operator} onChange={(event) => setOperator(event.target.value)}>
          <option value="">Sin indicar</option>
          {(catalog?.drivers ?? []).map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
          <option value={OTHER}>Otro (escribir el nombre)</option>
        </select>
        {operator === OTHER ? (
          <input className="inp" style={{ marginTop: 8 }} aria-label="Nombre del operador" value={operatorName} maxLength={120} autoComplete="off" onChange={(event) => setOperatorName(event.target.value)} />
        ) : null}
      </div>
      <div>
        <Label htmlFor="ot-ingreso">Fecha y hora de ingreso</Label>
        <input id="ot-ingreso" type="datetime-local" className={errors.entryAt ? "inp bad" : "inp"} value={entryAt} max={nowLocalMax()} aria-invalid={Boolean(errors.entryAt)} onChange={(event) => { setEntryAt(event.target.value); setErrors({}) }} />
        <FieldError message={errors.entryAt} />
      </div>
      <div>
        <Label htmlFor="ot-lectura">{ot.unit === "km" ? "Odómetro al ingresar" : "Horómetro al ingresar"}</Label>
        <input id="ot-lectura" className={errors.reading ? "inp bad" : "inp"} inputMode="numeric" autoComplete="off" value={parseReadingInput(readingText).text} aria-invalid={Boolean(errors.reading)}
          onChange={(event) => { setReadingText(event.target.value); setErrors({}) }} />
        {last ? <p className="hint">Última lectura del {meter}: <span className="mono">{formatReading(last.value, ot.unit)}</span></p> : null}
        <FieldError message={errors.reading} />
      </div>
      <div>
        <Label htmlFor="ot-entrega">Fecha estimada de entrega</Label>
        <input id="ot-entrega" type="date" className={errors.estimate ? "inp bad" : "inp"} value={estimate} min={entryDay ?? undefined} aria-invalid={Boolean(errors.estimate)} onChange={(event) => { setEstimate(event.target.value); setErrors({}) }} />
        <FieldError message={errors.estimate} />
      </div>
      <FieldError message={error ?? undefined} />
      <button type="button" className="btnp" onClick={submit} disabled={saving}>Registrar ingreso</button>
      <button type="button" className="btns wide" onClick={onBack} disabled={saving}>Volver</button>
    </>
  )
}
