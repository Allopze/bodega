"use client"

import type { ReactNode } from "react"
import { formatHours, formatReading, parseReadingInput } from "@/lib/mantencion/format"
import type { FleetRow } from "@/lib/mantencion/client/fleet-view"
import type { FlowDraft } from "@/lib/mantencion/client/flow-types"
import { partsFilled, parseQuantity } from "@/lib/mantencion/client/flow-validate"
import { formatDate } from "@/lib/utils"
import { useAppData } from "./app-context"
import { EquipmentSummary } from "./step-lectura"

function Row({ label, children, step, onChange }: { label: string; children: ReactNode; step: number; onChange: (step: number) => void }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        <span>{children}</span>
        <button type="button" className="lnk xs" onClick={() => onChange(step)} aria-label={`Cambiar ${label.toLowerCase()}`}>Cambiar</button>
      </dd>
    </>
  )
}

const names = (ids: string[], list: Array<{ id: string; name: string }>) => ids.map((id) => list.find((item) => item.id === id)?.name ?? id)

/**
 * Revisar: todo lo ingresado en un resumen; cada dato tiene «Cambiar», que lleva
 * a su paso y vuelve directo aquí (salvo que el cambio invalide un paso que
 * quedó en medio: ahí se detiene).
 */
export function StepRevisar({ draft, row, onChange }: { draft: FlowDraft; row: FleetRow; onChange: (step: number) => void }) {
  const { stored, account } = useAppData()
  const catalog = stored?.catalog
  const unit = row.eq.unit
  const reading = parseReadingInput(draft.readingText).value ?? 0

  if (draft.kind === "P") {
    const items = draft.checklist
    const count = (value: "R" | "NR" | "NA") => items.filter((item) => draft.marks[item.key] === value).length
    const [done, notDone, na] = [count("R"), count("NR"), count("NA")]
    const manual = draft.intervalValue !== null && draft.intervalValue !== draft.suggestedIntervalValue
    return (
      <>
        <EquipmentSummary row={row} />
        <dl className="dl">
          <dt>Tipo</dt><dd>Preventiva</dd>
          <Row label="Pauta" step={1} onChange={onChange}>{draft.intervalValue ? formatReading(draft.intervalValue, unit) : "—"}{manual ? " (elegida a mano)" : ""}</Row>
          <Row label="Lectura" step={1} onChange={onChange}><span className="mono" style={{ fontSize: 15 }}>{formatReading(reading, unit)}</span></Row>
          <Row label="Fecha" step={1} onChange={onChange}>{formatDate(draft.workDate)}</Row>
          <Row label="Fotos" step={3} onChange={onChange}>{[draft.photos.filtros, draft.photos.sticker].filter(Boolean).length} de 2</Row>
          <Row label="Observ." step={3} onChange={onChange}>{draft.notes}</Row>
        </dl>
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div className="cap">Resultado de la pauta · {items.length} ítems</div>
            <button type="button" className="lnk xs" onClick={() => onChange(2)}>Revisar ítems</button>
          </div>
          <div className="stack" aria-hidden="true">
            {done ? <div style={{ flex: done, background: "var(--gi)" }} /> : null}
            {notDone ? <div style={{ flex: notDone, background: "var(--or)" }} /> : null}
            {na ? <div style={{ flex: na, background: "var(--gr)" }} /> : null}
          </div>
          <div className="trio"><div><strong>{done}</strong>Realizados</div><div><strong>{notDone}</strong>No realizados</div><div><strong>{na}</strong>No aplica</div></div>
          {notDone > 0 ? (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--ln3)", fontSize: 15, lineHeight: 1.4 }}>
              <strong>No realizados:</strong> {items.filter((item) => draft.marks[item.key] === "NR").map((item) => `${item.name} (${draft.reasons[item.key] ?? ""})`).join("; ")}
            </div>
          ) : null}
        </div>
      </>
    )
  }

  const who = draft.executorKind === "yo"
    ? account.name
    : draft.executorKind === "otro_mecanico"
      ? names([draft.executorUserId], catalog?.mechanics ?? []).join("")
      : `${names([draft.executorWorkshopId], catalog?.workshops ?? []).join("")} (externo)`
  const oil = draft.noOilChange ? "No se cambió" : names(draft.oilIds, catalog?.oils ?? []).join(", ")
  const parts = draft.noParts ? "No se usaron" : partsFilled(draft).map((part) => `${parseQuantity(part.quantity)} × ${part.description.trim()}`).join(", ")
  return (
    <>
      <EquipmentSummary row={row} />
      <dl className="dl">
        <Row label="Trabajo" step={2} onChange={onChange}>Correctiva · {names(draft.workTypeIds, catalog?.workTypes ?? []).join(", ")}</Row>
        <Row label="Lectura" step={1} onChange={onChange}><span className="mono" style={{ fontSize: 15 }}>{formatReading(reading, unit)}</span></Row>
        <Row label="Fecha" step={1} onChange={onChange}>{formatDate(draft.workDate)}</Row>
        <Row label="Hecho por" step={2} onChange={onChange}>{who}</Row>
        <Row label="Aceite" step={2} onChange={onChange}>{oil}</Row>
        <Row label="Detalle" step={2} onChange={onChange}>{draft.description}</Row>
        <Row label="Repuestos" step={2} onChange={onChange}>{parts}</Row>
        <Row label="Horas" step={2} onChange={onChange}>{formatHours(draft.hours)}</Row>
        <Row label="En taller" step={2} onChange={onChange}>{draft.inWorkshop ? `Sí, desde ${formatDate(draft.workshopEntryDate)}` : "No"}</Row>
        <Row label="Conductores" step={2} onChange={onChange}>{names(draft.driverIds, catalog?.drivers ?? []).join(", ")}</Row>
        <Row label="Fotos" step={2} onChange={onChange}>{draft.photos.correctiva.length}</Row>
      </dl>
    </>
  )
}
