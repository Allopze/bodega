"use client"

import { useState } from "react"
import { OT_ITEM_KINDS, OT_ITEM_KIND_LABELS, OT_ITEM_MAX_PER_KIND, type OtItemKind } from "@/lib/mantencion/work-order-states"
import { canAddItem } from "@/lib/mantencion/client/ot-model"
import type { OtView } from "@/lib/mantencion/client/ot-model"
import type { OtOpBody } from "./use-ot-op"
import { FieldError } from "./ui"

type Mark = { done: "si" | "no" | null; note: string }
type Added = { id: string; kind: OtItemKind; description: string }

/**
 * SÍ/NO por cada ítem pedido, y los ítems que se agregan en el taller. Se guarda
 * todo junto con un solo botón (una operación, no una por toque). Un ítem recién
 * agregado se marca después de guardar: así la plataforma ya lo conoce.
 */
export function OtItemsEditor({ view, saving, error, onSubmit, onBack }: {
  view: OtView
  saving: boolean
  error: string | null
  onSubmit: (body: OtOpBody) => void
  onBack: () => void
}) {
  const { ot } = view
  const [marks, setMarks] = useState<Record<string, Mark>>(() => Object.fromEntries(ot.items.map((item) => [item.id, { done: item.done, note: item.note ?? "" }])))
  const [added, setAdded] = useState<Added[]>([])
  const [draftText, setDraftText] = useState<Record<OtItemKind, string>>({ anexo: "", mantencion: "" })
  const [problem, setProblem] = useState<string | null>(null)

  const setMark = (id: string, patch: Partial<Mark>) => { setMarks((current) => ({ ...current, [id]: { ...(current[id] ?? { done: null, note: "" }), ...patch } })); setProblem(null) }

  const addItem = (kind: OtItemKind) => {
    const description = draftText[kind].trim()
    if (description.length < 3) { setProblem("Describe el ítem (mínimo 3 letras)."); return }
    setAdded((current) => [...current, { id: crypto.randomUUID(), kind, description }])
    setDraftText((current) => ({ ...current, [kind]: "" }))
    setProblem(null)
  }

  const save = () => {
    const changed = ot.items.flatMap((item) => {
      const mark = marks[item.id]
      if (!mark?.done) return []
      const note = mark.done === "no" ? mark.note.trim() || null : null
      return mark.done === item.done && note === (item.note ?? null) ? [] : [{ itemId: item.id, done: mark.done, note }]
    })
    if (changed.length === 0 && added.length === 0) { setProblem("No cambiaste nada: marca algún ítem con SÍ o NO, o agrega uno."); return }
    onSubmit({ action: "items", marks: changed, added })
  }

  return (
    <>
      <p className="hint" style={{ marginTop: 0 }}>Marca cada ítem pedido con SÍ (se hizo) o NO (no se hizo). Para terminar la OT todos deben tener una respuesta.</p>
      {OT_ITEM_KINDS.map((kind) => {
        const items = ot.items.filter((item) => item.kind === kind)
        const fresh = added.filter((item) => item.kind === kind)
        if (items.length === 0 && fresh.length === 0 && !(kind === "anexo" ? ot.repair : ot.maintenance)) return null
        const room = canAddItem(ot, kind, fresh.length)
        return (
          <section key={kind} className="sect" aria-label={OT_ITEM_KIND_LABELS[kind]}>
            <div className="cap">{OT_ITEM_KIND_LABELS[kind]}</div>
            {items.length === 0 && fresh.length === 0 ? <p className="empty">Sin ítems todavía.</p> : null}
            {items.map((item) => {
              const mark = marks[item.id] ?? { done: null, note: "" }
              return (
                <div key={item.id} className="card" style={{ padding: 12 }}>
                  <div id={`it-${item.id}`} style={{ fontSize: 16, marginBottom: 8 }}>{item.description}{item.origin === "taller" ? <span className="hint"> · agregado en taller</span> : null}</div>
                  <div className="seg" role="group" aria-labelledby={`it-${item.id}`} style={{ gridTemplateColumns: "1fr 1fr" }}>
                    <button type="button" aria-pressed={mark.done === "si"} onClick={() => setMark(item.id, { done: "si" })}>SÍ</button>
                    <button type="button" aria-pressed={mark.done === "no"} onClick={() => setMark(item.id, { done: "no" })}>NO</button>
                  </div>
                  {mark.done === "no" ? (
                    <input className="inp sm" style={{ marginTop: 8 }} aria-label={`Motivo de «${item.description}» (opcional)`} placeholder="Motivo (opcional)" maxLength={300} value={mark.note} autoComplete="off" onChange={(event) => setMark(item.id, { note: event.target.value })} />
                  ) : null}
                </div>
              )
            })}
            {fresh.map((item) => (
              <div key={item.id} className="card" style={{ padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontSize: 16, minWidth: 0 }}>{item.description}<div className="hint">Nuevo · se marca después de guardar</div></div>
                <button type="button" className="lnk xs" aria-label={`Quitar «${item.description}»`} onClick={() => setAdded((current) => current.filter((entry) => entry.id !== item.id))}>Quitar</button>
              </div>
            ))}
            {room ? (
              <div style={{ display: "flex", gap: 8 }}>
                <input className="inp sm" style={{ flex: 1, minWidth: 0 }} aria-label={`Agregar ítem a «${OT_ITEM_KIND_LABELS[kind]}»`} placeholder="Agregar un ítem del taller" maxLength={300} value={draftText[kind]} autoComplete="off"
                  onChange={(event) => setDraftText((current) => ({ ...current, [kind]: event.target.value }))}
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addItem(kind) } }} />
                <button type="button" className="btns" onClick={() => addItem(kind)} aria-label={`Agregar a «${OT_ITEM_KIND_LABELS[kind]}»`}>Agregar</button>
              </div>
            ) : <p className="hint">Llegaste al máximo de {OT_ITEM_MAX_PER_KIND} ítems en esta lista.</p>}
          </section>
        )
      })}
      <FieldError message={problem ?? error ?? undefined} />
      <button type="button" className="btnp" onClick={save} disabled={saving}>Guardar marcas</button>
      <button type="button" className="btns wide" onClick={onBack} disabled={saving}>Volver</button>
    </>
  )
}
