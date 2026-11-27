"use client"

import { useEffect, useId, useRef, type RefObject } from "react"
import type { CatalogSparePart } from "@/lib/mantencion/contracts"
import { NO_CHARGE, type ChargeChoices, chargeOfCostCenter, chargeOfVehicle } from "@/lib/mantencion/client/parts-request-model"
import { fillFromSparePart, type SparePartIndex } from "@/lib/mantencion/client/spare-part-search"
import { IconClose } from "./icons"
import { SparePartField } from "./spare-part-field"
import { FieldError, Label } from "./ui"

/**
 * Las líneas del pedido de repuestos: lo comparten «Pedir repuestos» de una OT y el pedido sin OT del inicio. Cada
 * línea es todo texto hasta que el pedido se valida con el esquema del servidor (`partsNoteSchema`). Cada línea se puede
 * escribir libre o elegir del catálogo de repuestos (`productId` + `unit`: R15); lo escrito a mano siempre desvincula.
 */

export interface LineState {
  key: number; quantity: string; description: string; partNumber: string; partOpen: boolean; charge: string
  /** Repuesto del catálogo elegido (`null` = texto libre) y su unidad; sin repuesto la unidad es «unidad». */
  productId: string | null; unit: string
}
export interface LineErrors { description?: string; quantity?: string }
export interface FormErrors { lines: Record<number, LineErrors>; general?: string; worksite?: string }

export const QUANTITY_MAX_DIGITS = 6
/** Una línea nueva hereda el cargo de la anterior: casi siempre un pedido es para el mismo equipo. */
export const blankLine = (key: number, charge: string = NO_CHARGE): LineState => ({ key, quantity: "1", description: "", partNumber: "", partOpen: false, charge, productId: null, unit: "unidad" })

/** Elegir un repuesto del catálogo rellena nombre, unidad y N° de parte; el N° que ya se había escrito se respeta si el repuesto no trae uno. */
export function lineFromPart(line: LineState, part: CatalogSparePart): Partial<LineState> {
  const fill = fillFromSparePart(part)
  const partNumber = fill.partNumber || line.partNumber
  return { productId: fill.productId, description: fill.description, unit: fill.unit, partNumber, partOpen: line.partOpen || partNumber !== "" }
}

/** Escribir a mano suelta el vínculo: el texto ya no es el del repuesto. Su N° de parte, si no se tocó, se va con él. */
export function lineFromText(line: LineState, text: string, linked: CatalogSparePart | null): Partial<LineState> {
  if (!line.productId) return { description: text }
  return { description: text, productId: null, unit: "unidad", ...(linked?.partNumber && line.partNumber === linked.partNumber ? { partNumber: "" } : {}) }
}
export const quantityOf = (line: LineState): number => Number(line.quantity || "0")

/** ¿Hay algo escrito que se perdería al cerrar? (Una línea en blanco, con su cargo heredado, no cuenta.) */
export function linesDirty(lines: readonly LineState[]): boolean {
  return lines.length > 1 || lines.some((line) => line.description.trim() !== "" || line.partNumber.trim() !== "" || line.quantity !== "1")
}

/** Los errores del esquema, cada uno junto al campo que corresponde; lo que no es de una línea va al pie. */
export function errorsFrom(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string; code: string }>, lines: readonly LineState[]): FormErrors {
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

/** «Cargo (opcional)»: a qué centro de costo o equipo de la faena se imputa el repuesto. */
function ChargeSelect({ id, value, choices, onChange }: { id: string; value: string; choices: ChargeChoices; onChange: (value: string) => void }) {
  return (
    <div>
      <Label htmlFor={id} size="sm" hint="opcional">Cargo</Label>
      <select id={id} className="inp sm" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value={NO_CHARGE}>Sin cargo</option>
        {choices.costCenters.length > 0 ? (
          <optgroup label="Centro de costo">
            {choices.costCenters.map((center) => <option key={center.id} value={chargeOfCostCenter(center.id)}>{center.name}</option>)}
          </optgroup>
        ) : null}
        {choices.equipment.length > 0 ? (
          <optgroup label="Equipo de la faena">
            {choices.equipment.map((eq) => <option key={eq.id} value={chargeOfVehicle(eq.id)}>{eq.label}</option>)}
          </optgroup>
        ) : null}
      </select>
    </div>
  )
}

export function LineCard({ line, number, errors, removable, firstRef, focusNow, charges, parts, onChange, onRemove }: {
  line: LineState; number: number; errors: LineErrors | undefined; removable: boolean; firstRef: RefObject<HTMLInputElement | null> | null
  /** Una línea recién agregada recibe el foco: el teclado sube y la hoja la trae a la vista. */
  focusNow: boolean
  /** Con opciones de cargo (pedido sin OT), la línea ofrece «Cargo»; sin ellas, no. */
  charges: ChargeChoices | null
  /** El catálogo de repuestos para buscar; `null` si el teléfono no lo trae (sólo texto libre). */
  parts: SparePartIndex | null
  onChange: (change: Partial<LineState>) => void; onRemove: () => void
}) {
  const head = useId()
  const descId = useId()
  const partId = useId()
  const errId = useId()
  const chargeId = useId()
  const own = useRef<HTMLInputElement | null>(null)
  useEffect(() => { if (focusNow) own.current?.focus() }, [focusNow])
  const linked = (line.productId && parts?.byId.get(line.productId)) || null
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
        <SparePartField id={descId} inputRef={(node) => { own.current = node; if (firstRef) firstRef.current = node }} value={line.description} linked={linked} index={parts}
          invalid={Boolean(errors?.description)} describedBy={errors?.description ? errId : undefined}
          onType={(text) => onChange(lineFromText(line, text, linked))} onPick={(part) => onChange(lineFromPart(line, part))} />
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
      {charges && (charges.costCenters.length > 0 || charges.equipment.length > 0)
        ? <ChargeSelect id={chargeId} value={line.charge} choices={charges} onChange={(charge) => onChange({ charge })} />
        : null}
    </div>
  )
}
