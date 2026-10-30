"use client"

import { useState } from "react"
import type { CatalogObservation } from "@/lib/mantencion/contracts"
import { observationReplySchema } from "@/lib/mantencion/contracts"
import { StorageFullError } from "@/lib/mantencion/client/db"
import { enqueueSimple, newReplyItem } from "@/lib/mantencion/client/queue"
import { formatDateTime } from "@/lib/utils"
import { useAppActions, useAppData } from "./app-context"
import { Sheet } from "./dialog"
import { FieldError, Label } from "./ui"

function ObservationItem({ observation, onSaved }: { observation: CatalogObservation; onSaved: () => void }) {
  const { account, online } = useAppData()
  const { syncNow, toast } = useAppActions()
  const [text, setText] = useState("")
  const [error, setError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)
  const inputId = `obs-${observation.id}`

  const send = async () => {
    const parsed = observationReplySchema.safeParse({ observationId: observation.id, response: text })
    if (!parsed.success) { setError("Escribe tu respuesta."); return }
    setSaving(true)
    try {
      await enqueueSimple(newReplyItem({
        authorUserId: account.userId,
        payload: parsed.data,
        summary: { folio: observation.folio, equipmentCode: observation.equipmentCode },
      }, crypto.randomUUID()))
      toast(online ? "Respuesta guardada. Enviando…" : "Respuesta guardada en el teléfono.")
      syncNow()
      onSaved()
    } catch (cause) {
      setError(cause instanceof StorageFullError ? cause.message : "No pudimos guardar la respuesta. Intenta de nuevo.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <div className="mono nw" style={{ fontWeight: 600, fontSize: 15 }}>{observation.folio ?? "Registro"} · {observation.equipmentCode}</div>
        <div className="hint" style={{ marginTop: 2 }}>{observation.by} · {formatDateTime(observation.createdAt)}</div>
      </div>
      <p style={{ margin: 0, fontSize: 16, lineHeight: 1.4 }}>{observation.text}</p>
      <div>
        <Label htmlFor={inputId} size="sm">Tu respuesta</Label>
        <textarea id={inputId} className={error ? "inp bad" : "inp"} rows={2} value={text} aria-invalid={Boolean(error)} onChange={(event) => { setText(event.target.value); setError(undefined) }} />
        <FieldError message={error} />
      </div>
      <button type="button" className="btns wide pri" onClick={() => { void send() }} disabled={saving} aria-label={`Enviar respuesta sobre ${observation.equipmentCode}`}>Enviar respuesta</button>
    </div>
  )
}

/** Lo que dejó el supervisor o jefatura sobre un registro; el mecánico responde y queda en la bitácora. */
export function ObservationSheet({ observations, onClose }: { observations: CatalogObservation[]; onClose: () => void }) {
  return (
    <Sheet title="Registros observados" onClose={onClose}>
      {observations.length === 0 ? <p className="empty">No quedan observaciones por responder.</p> : observations.map((observation) => (
        <ObservationItem key={observation.id} observation={observation} onSaved={() => { if (observations.length <= 1) onClose() }} />
      ))}
      <button type="button" className="btns wide" onClick={onClose}>Cerrar</button>
    </Sheet>
  )
}
