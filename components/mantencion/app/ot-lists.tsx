"use client"

import { useState, type CSSProperties } from "react"
import { equipmentLabel } from "@/lib/mantencion/client/fleet-view"
import { isClosedStatus, type OtView, type OtViews } from "@/lib/mantencion/client/ot-model"
import { OT_STATUS_LABELS, type OtStatus } from "@/lib/mantencion/work-order-states"
import { formatDate } from "@/lib/utils"
import { IconChevronDown, IconChevronRight, IconChevronUp } from "./icons"

/** «Reparación», «Mantención» o «Reparación y mantención», según lo marcado en el talonario. */
export function otKindText(ot: { repair: boolean; maintenance: boolean }): string {
  if (ot.repair && ot.maintenance) return "Reparación y mantención"
  return ot.repair ? "Reparación" : "Mantención"
}

/** Sólo `en_ejecucion` y `trabajo_terminado` piden atención (ámbar); cerrada se ve tranquila; el resto va en verde suave. */
const TAG_STYLE: Record<OtStatus, CSSProperties> = {
  solicitada: { background: "var(--ln3)", color: "var(--ink)" },
  asignada: { background: "var(--gt)", color: "var(--gi)" },
  en_ejecucion: { background: "#fff3c4", color: "#5c4600" },
  trabajo_terminado: { background: "var(--gt)", color: "var(--gi)" },
  recepcionada: { background: "var(--gt)", color: "var(--gi)" },
  cerrada: { background: "var(--ln3)", color: "var(--ink)" },
  anulada: { background: "#fbe3dc", color: "#8f1c12" },
}

function OtCard({ view, onOpen }: { view: OtView; onOpen: (view: OtView) => void }) {
  const { ot } = view
  const eq = equipmentLabel({ code: ot.equipmentCode, plate: ot.equipmentPlate })
  return (
    <button type="button" className="duerow" style={{ alignItems: "flex-start" }} onClick={() => onOpen(view)}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="c">{eq}</div>
        <div className="d"><span className="mono nw" style={{ fontSize: 14 }}>{ot.folio}</span> · {otKindText(ot)}</div>
        {ot.entry ? <div className="d">Entrega estimada: <span className="nw">{formatDate(ot.entry.estimatedDeliveryDate)}</span></div> : null}
        {ot.outOfWorksite ? <div className="d">Equipo de otra faena · {ot.worksiteName}</div> : null}
        {view.returnedReason ? <div className="d" style={{ color: "var(--err)", fontWeight: 700 }}>Devuelta: {view.returnedReason}</div> : null}
        {view.rejected.length > 0 ? <div className="d" style={{ color: "var(--err)", fontWeight: 700 }}>Un cambio no se pudo enviar. Ábrela para verlo.</div> : null}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
        <span className="dtag" style={TAG_STYLE[ot.status]}>{OT_STATUS_LABELS[ot.status]}</span>
        {view.pending ? <span className="dtag" style={{ background: "var(--amt)", color: "var(--ink)" }}>Sin enviar</span> : null}
      </div>
      <IconChevronRight />
    </button>
  )
}

function Fold({ id, label, count, defaultOpen = false, children }: { id: string; label: string; count: number; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  if (count === 0) return null
  return (
    <div className="sect" style={{ gap: 8 }}>
      <button type="button" className="lnk" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
        {label} ({count}){open ? <IconChevronUp /> : <IconChevronDown />}
      </button>
      {open ? <div id={id} className="sect" style={{ gap: 8 }}>{children}</div> : null}
    </div>
  )
}

/**
 * «Órdenes de trabajo»: las mías (lo que pide acción primero), las disponibles
 * para tomar (plegadas) y las cerradas recientes (plegadas). Sin OT de ninguna
 * clase no ocupa lugar en el inicio.
 */
export function OtSection({ views, onOpen }: { views: OtViews; onOpen: (view: OtView) => void }) {
  const open = views.mine.filter((view) => !isClosedStatus(view.ot.status))
  const closed = views.mine.filter((view) => isClosedStatus(view.ot.status))
  if (views.mine.length === 0 && views.available.length === 0) return null
  return (
    <section className="sect" aria-labelledby="h-ot">
      <div className="cap" id="h-ot">Órdenes de trabajo</div>
      {open.length === 0 ? <p className="empty">No tienes órdenes de trabajo asignadas.{views.available.length > 0 ? " Puedes tomar una de las disponibles." : ""}</p> : open.map((view) => <OtCard key={view.ot.id} view={view} onOpen={onOpen} />)}
      <Fold id="ot-disponibles" label="OT disponibles" count={views.available.length} defaultOpen={open.length === 0}>
        {views.available.map((view) => <OtCard key={view.ot.id} view={view} onOpen={onOpen} />)}
      </Fold>
      <Fold id="ot-cerradas" label="Cerradas recientes" count={closed.length}>
        {closed.map((view) => <OtCard key={view.ot.id} view={view} onOpen={onOpen} />)}
      </Fold>
    </section>
  )
}
