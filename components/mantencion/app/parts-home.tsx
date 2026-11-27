"use client"

import { useMemo, useState } from "react"
import { buildMyNotes, splitMyNotes } from "@/lib/mantencion/client/parts-notes-model"
import { canRequestParts } from "@/lib/mantencion/client/parts-request-model"
import { useAppActions, useAppData } from "./app-context"
import { MyNotesSheet } from "./my-notes-sheet"
import { PartsNoteSheet } from "./parts-note-sheet"

/**
 * «Repuestos» del inicio: pedir repuestos sin OT (a una faena suya, con cargo opcional por línea) y ver mis notas, con y
 * sin OT. «Pedir repuestos» sólo se ofrece si la plataforma dice que la cuenta puede (`user.canRequestParts`); «Mis notas»
 * aparece apenas hay una nota, también la que aún está en el teléfono. Sin ninguna de las dos no ocupa lugar.
 */
export function PartsHomeSection() {
  const { account, stored, queue } = useAppData()
  const { toast } = useAppActions()
  const [asking, setAsking] = useState(false)
  const [listing, setListing] = useState(false)
  const catalog = stored?.catalog
  const notes = useMemo(() => buildMyNotes(catalog, queue, account.userId), [catalog, queue, account.userId])
  const canAsk = canRequestParts(catalog)
  const inProgress = splitMyNotes(notes).open.length
  if (!canAsk && notes.length === 0) return null
  return (
    <section className="sect" aria-labelledby="h-repuestos">
      <div className="cap" id="h-repuestos">Repuestos</div>
      <div style={{ display: "grid", gridTemplateColumns: canAsk && notes.length > 0 ? "1fr 1fr" : "1fr", gap: 10 }}>
        {canAsk ? <button type="button" className="btns wide" aria-haspopup="dialog" onClick={() => setAsking(true)}>Pedir repuestos</button> : null}
        {notes.length > 0 ? (
          <button type="button" className="btns wide" aria-haspopup="dialog" onClick={() => setListing(true)}>
            Mis notas{inProgress > 0 ? ` (${inProgress})` : ""}
          </button>
        ) : null}
      </div>
      {asking ? <PartsNoteSheet onClose={() => setAsking(false)} onSaved={() => { setAsking(false); toast("Pedido guardado en el teléfono. Se envía cuando haya señal.") }} /> : null}
      {listing ? <MyNotesSheet notes={notes} onClose={() => setListing(false)} /> : null}
    </section>
  )
}
