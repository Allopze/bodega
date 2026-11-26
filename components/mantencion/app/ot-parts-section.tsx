"use client"

import { useId, useState, type ReactNode } from "react"
import { discardRejectedNote } from "@/lib/mantencion/client/queue"
import { partStatusText, qtyText, type OtPartLine, type OtView } from "@/lib/mantencion/client/ot-model"
import { PartsNoteSheet } from "./parts-note-sheet"
import { Banner } from "./ui"

/** Un ícono por etapa, siempre decorativo: la etapa ya va dicha con texto. */
function StageIcon({ line }: { line: OtPartLine }) {
  let paths: ReactNode
  if (line.stage === "por_enviar") paths = <><path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M5 20h14" /></>
  else if (line.stage === "pedido") paths = <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>
  else if (line.stage === "en_compra") paths = <><path d="M3 4h2l2.4 10.2a1 1 0 0 0 1 .8h8.2a1 1 0 0 0 1-.8L19 8H6" /><circle cx="9" cy="19" r="1.2" /><circle cx="17" cy="19" r="1.2" /></>
  else if (line.stage === "rechazado") paths = <><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></>
  else if (line.used > 0) paths = <path d="M20 6L9 17l-5-5" />
  else paths = <><path d="M21 8l-9-5-9 5v8l9 5 9-5z" /><path d="M3 8l9 5 9-5" /><path d="M12 13v8" /></>
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths}</svg>
  )
}

function PartRow({ line }: { line: OtPartLine }) {
  const status = partStatusText(line)
  const unit = line.unit && line.unit !== "unidad" ? ` ${line.unit}` : ""
  return (
    <li className="prow">
      <span className={`pico ${status.tone}`} aria-hidden="true"><StageIcon line={line} /></span>
      <div className="prtxt">
        <div className="prname"><span className="prq">{qtyText(line.quantity)}{unit}</span> <span>{line.description}</span></div>
        <div className={`pst ${status.tone}`}>{status.label}</div>
        {status.detail ? <div className="hint" style={{ marginTop: 0 }}>{status.detail}</div> : null}
        {line.noteCode ? <div className="prnp">{line.noteCode}</div> : null}
      </div>
    </li>
  )
}

/**
 * «Repuestos» de la OT: lo que el mecánico pidió y en qué va (pedido, en compra, llegó, usado o rechazado), con
 * lo que aún está en el teléfono como «por enviar». Con la OT asignada o en ejecución se puede pedir más.
 */
export function OtPartsSection({ view }: { view: OtView }) {
  const heading = useId()
  const [asking, setAsking] = useState(false)
  const [saved, setSaved] = useState(false)
  const { partsLines, partsRejected, flags } = view
  if (partsLines.length === 0 && partsRejected.length === 0 && !flags.canRequestParts && !saved) return null
  return (
    <section className="card" aria-labelledby={heading} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="cap" id={heading}>Repuestos</div>
      {saved ? <Banner tone="ok">Pedido guardado en el teléfono. Se envía cuando haya señal.</Banner> : null}
      {partsRejected.map((rejected) => (
        <Banner key={rejected.id} action={<button type="button" className="lnk" onClick={() => { void discardRejectedNote(rejected.id) }}>Entendido</button>}>
          <strong>No se pudo enviar el pedido de repuestos</strong>
          <div>{rejected.message}</div>
        </Banner>
      ))}
      {partsLines.length > 0
        ? <ul className="prlist">{partsLines.map((line) => <PartRow key={line.key} line={line} />)}</ul>
        : flags.canRequestParts ? <p className="empty" style={{ padding: 0 }}>Aún no pediste repuestos para esta OT.</p> : null}
      {flags.canRequestParts ? <button type="button" className="btns wide" onClick={() => { setSaved(false); setAsking(true) }}>Pedir repuestos</button> : null}
      {asking ? <PartsNoteSheet view={view} onClose={() => setAsking(false)} onSaved={() => { setAsking(false); setSaved(true) }} /> : null}
    </section>
  )
}
