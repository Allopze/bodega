"use client"

import { useId, useState, type CSSProperties } from "react"
import { shortWhen } from "@/lib/mantencion/client/home-model"
import { splitMyNotes, type MyNote, type MyNoteLine, type NoteTone } from "@/lib/mantencion/client/parts-notes-model"
import { qtyText } from "@/lib/mantencion/client/ot-model"
import { discardRejectedNote } from "@/lib/mantencion/client/queue"
import { useAppData } from "./app-context"
import { Sheet } from "./dialog"
import { IconChevronDown, IconChevronUp } from "./icons"
import { StageIcon } from "./ot-parts-section"

/**
 * «Mis notas»: las notas de pedido de repuestos del mecánico, con y sin OT, con su estado en palabras, el motivo a la vista
 * cuando está en espera, rechazada o anulada (o una línea rechazada) y el avance de lo que llegó por línea («Llegó 2 de 5»).
 * Las que aún están en el teléfono salen «Por enviar». Es una lista de lectura: pedir más se hace desde «Pedir repuestos».
 */

/** El estado nunca va sólo en color: es el texto de la etiqueta; el color lo refuerza. */
const TAG: Record<NoteTone, CSSProperties> = {
  wait: { background: "#fff3c4", color: "#5c4600" },
  info: { background: "var(--ln3)", color: "var(--ink)" },
  ok: { background: "var(--gt)", color: "var(--gi)" },
  bad: { background: "#fbe3dc", color: "#8f1c12" },
}

function LineRow({ line }: { line: MyNoteLine }) {
  const unit = line.unit && line.unit !== "unidad" ? ` ${line.unit}` : ""
  return (
    <li className="prow">
      <span className={`pico ${line.tone}`} aria-hidden="true"><StageIcon line={line} /></span>
      <div className="prtxt">
        <div className="prname"><span className="prq">{qtyText(line.quantity)}{unit}</span> <span>{line.description}</span></div>
        <div className={`pst ${line.tone}`}>{line.label}</div>
        {line.detail ? <div className="hint" style={{ marginTop: 0 }}>{line.detail}</div> : null}
      </div>
    </li>
  )
}

/** Sin OT: la faena; con OT: el equipo y su folio. */
function whereOf(note: MyNote): string {
  if (note.workOrderFolio) return [note.equipment, note.workOrderFolio].filter(Boolean).join(" · ")
  return note.worksiteName ? `Sin OT · ${note.worksiteName}` : "Sin OT"
}

/** El avance de lo pedido: «Llegó 1 de 3 repuestos». Las líneas rechazadas no se esperan, no cuentan. */
function arrivalsText(note: MyNote): string {
  return `${note.arrivedLines === 1 ? "Llegó" : "Llegaron"} ${note.arrivedLines} de ${note.expectedLines} ${note.expectedLines === 1 ? "repuesto" : "repuestos"}`
}

function NoteCard({ note, now }: { note: MyNote; now: number }) {
  const heading = useId()
  const lines = note.lines
  const arrivals = note.arrivedLines > 0 && note.state !== "por_enviar" && note.state !== "no_enviada"
  return (
    <section className="card" aria-labelledby={heading} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div id={heading} className="mono nw" style={{ fontWeight: 600, fontSize: 15 }}>{note.code ?? "Pedido de repuestos"}</div>
          <div className="hint" style={{ marginTop: 2, overflowWrap: "anywhere" }}>{whereOf(note)}</div>
          <div className="hint" style={{ marginTop: 0 }}>{shortWhen(note.createdAt, now)}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
          <span className="dtag" style={TAG[note.tone]}>{note.label}</span>
          {note.urgent ? <span className="dtag" style={TAG.bad}>Urgente</span> : null}
        </div>
      </div>
      <div className="hint" style={{ margin: 0 }}>{note.detail}</div>
      {note.reason ? (
        <div className={note.tone === "bad" ? "pst bad" : "pst"}>{note.state === "en_espera" ? "Motivo de la espera" : "Motivo"}: {note.reason}</div>
      ) : null}
      {arrivals ? <div className="pst ok">{arrivalsText(note)}</div> : null}
      {note.observation ? <div className="hint" style={{ margin: 0 }}>Tu observación: {note.observation}</div> : null}
      <ul className="prlist" aria-label={`Repuestos de ${note.code ?? "este pedido"}`}>
        {lines.map((line) => <LineRow key={line.key} line={line} />)}
      </ul>
      {note.state === "no_enviada" && note.queueId ? (
        <button type="button" className="lnk" onClick={() => { void discardRejectedNote(note.queueId!) }}>Entendido</button>
      ) : null}
    </section>
  )
}

function Fold({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  if (count === 0) return null
  return (
    <div className="sect" style={{ gap: 8 }}>
      <button type="button" className="lnk" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
        {label} ({count}){open ? <IconChevronUp /> : <IconChevronDown />}
      </button>
      {open ? <div id={id} className="sect" style={{ gap: 10 }}>{children}</div> : null}
    </div>
  )
}

export function MyNotesSheet({ notes, onClose }: { notes: MyNote[]; onClose: () => void }) {
  const { now } = useAppData()
  const { open, closed } = splitMyNotes(notes)
  return (
    <Sheet title="Mis notas" onClose={onClose}>
      {notes.length === 0 ? <p className="empty">Todavía no pediste repuestos. Usa «Pedir repuestos» y tus pedidos aparecen aquí.</p> : null}
      {notes.length > 0 && open.length === 0 ? <p className="empty">No tienes pedidos en curso.</p> : null}
      {open.map((note) => <NoteCard key={note.key} note={note} now={now} />)}
      <Fold label="Cerradas, rechazadas y anuladas" count={closed.length}>
        {closed.map((note) => <NoteCard key={note.key} note={note} now={now} />)}
      </Fold>
      <button type="button" className="btns wide" onClick={onClose}>Cerrar</button>
    </Sheet>
  )
}
