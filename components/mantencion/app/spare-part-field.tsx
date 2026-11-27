"use client"

import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react"
import { plural } from "@/lib/mantencion/format"
import type { CatalogSparePart } from "@/lib/mantencion/contracts"
import { searchSpareParts, sparePartCodes, SPARE_PART_MIN_QUERY, type SparePartIndex } from "@/lib/mantencion/client/spare-part-search"
import { unitLabel } from "@/lib/products/unit-label"
import { PRODUCT_UNIT_LABELS } from "@/lib/products/units"

/**
 * «¿Qué repuesto necesitas?»: el campo de texto de siempre con un buscador del catálogo de repuestos encima (R15). Se
 * puede elegir un repuesto de la lista —queda vinculado al catálogo y rellena nombre, unidad y N° de parte— o escribir
 * libre y no elegir nada (la línea viaja sin repuesto). Todo local: la lista ya está en el teléfono, así que filtra sin red.
 *
 * Es un combobox con lista (patrón de WAI-ARIA): el foco se queda en el campo, las flechas mueven la opción activa
 * (`aria-activedescendant`), Enter la elige y Escape cierra la lista sin cerrar la hoja (`dialog.tsx` lo respeta).
 * Sin catálogo de repuestos (`index` nulo: catálogo antiguo o sin permiso) es exactamente el campo de texto de antes.
 */

export interface SparePartFieldProps {
  id: string
  inputRef: (node: HTMLInputElement | null) => void
  value: string
  /** Repuesto del catálogo al que está vinculada la línea, si eligió uno. */
  linked: CatalogSparePart | null
  index: SparePartIndex | null
  invalid: boolean
  describedBy: string | undefined
  /** Lo escrito a mano (también desvincula la línea del repuesto elegido). */
  onType: (text: string) => void
  onPick: (part: CatalogSparePart) => void
}

export function SparePartField({ id, inputRef, value, linked, index, invalid, describedBy, onType, onPick }: SparePartFieldProps) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const found = useMemo(() => (open && index ? searchSpareParts(index, value) : { results: [], total: 0 }), [open, index, value])
  const shown = found.results
  const expanded = shown.length > 0
  const optionId = (position: number) => `${listId}-${position}`

  // La opción activa siempre a la vista, aunque la hoja tenga que desplazarse.
  useEffect(() => {
    if (active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: "nearest" })
  }, [active, listId])

  const pick = (part: CatalogSparePart) => {
    setOpen(false)
    setActive(-1)
    onPick(part)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!index) return
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      if (!open) { setOpen(true); setActive(event.key === "ArrowDown" ? 0 : -1); return }
      if (shown.length === 0) return
      const step = event.key === "ArrowDown" ? 1 : -1
      setActive((current) => (current < 0 ? (step === 1 ? 0 : shown.length - 1) : (current + step + shown.length) % shown.length))
    } else if (event.key === "Enter" && expanded && active >= 0 && shown[active]) {
      event.preventDefault()
      pick(shown[active]!)
    } else if (event.key === "Escape" && open) {
      event.preventDefault()
      setOpen(false)
      setActive(-1)
    }
  }

  const input = (
    <input
      id={id} ref={inputRef} className={invalid ? "inp bad" : "inp"} value={value} maxLength={300} autoComplete="off" placeholder="Ej: Filtro de aceite"
      aria-invalid={invalid} aria-describedby={describedBy}
      {...(index ? {
        role: "combobox", "aria-autocomplete": "list" as const, "aria-expanded": expanded,
        "aria-controls": expanded ? listId : undefined, "aria-activedescendant": expanded && active >= 0 ? optionId(active) : undefined,
      } : {})}
      onChange={(event) => { onType(event.target.value); setOpen(true); setActive(-1) }}
      onBlur={(event) => {
        const close = () => { setOpen(false); setActive(-1) }
        // Un toque en un botón («+ Otro repuesto», «Enviar pedido») saca el foco del campo ANTES de que llegue el clic: cerrar
        // la lista ahí sube el botón de lugar y el clic se pierde (había que tocar dos veces). Se cierra cuando el toque termina.
        if (event.relatedTarget instanceof HTMLButtonElement) document.addEventListener("click", close, { once: true })
        else close()
      }}
      onKeyDown={onKeyDown}
    />
  )
  if (!index) return input

  const queryReady = value.trim().length >= SPARE_PART_MIN_QUERY
  const status = linked
    ? `Del catálogo · ${sparePartCodes(linked)} · Unidad: ${unitLabel(linked.unit, PRODUCT_UNIT_LABELS)}`
    : !open || !queryReady
      ? "Busca en el catálogo o escribe el repuesto con tus palabras."
      : shown.length === 0
        ? "No está en el catálogo: se pedirá como lo escribiste."
        : found.total > shown.length
          ? `${shown.length} de ${plural(found.total, "repuesto", "repuestos")} del catálogo. Escribe más para acotar.`
          : `${plural(found.total, "repuesto", "repuestos")} del catálogo. Toca uno para elegirlo o sigue escribiendo.`

  return (
    <>
      {input}
      {expanded ? (
        <div id={listId} role="listbox" aria-label="Repuestos del catálogo" className="list" style={{ marginTop: 8 }}>
          {shown.map((part, position) => (
            <div
              key={part.id} id={optionId(position)} role="option" aria-selected={position === active} className="eqrow"
              style={position === active ? { cursor: "pointer", background: "var(--gt)", boxShadow: "inset 0 0 0 1.5px var(--g)" } : { cursor: "pointer" }}
              onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(position)} onClick={() => pick(part)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: "600 16px/1.25 var(--ft)", overflowWrap: "anywhere" }}>{part.name}</div>
                <div className="d">{sparePartCodes(part)} · {unitLabel(part.unit, PRODUCT_UNIT_LABELS)}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <p className="hint" role="status" aria-live="polite">{status}</p>
    </>
  )
}
