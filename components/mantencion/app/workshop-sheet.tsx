"use client"

import { useState } from "react"
import { workshopUpdateSchema } from "@/lib/mantencion/contracts"
import { daysBetween } from "@/lib/mantencion/readings"
import { enqueueSimple, newWorkshopItem } from "@/lib/mantencion/client/queue"
import { StorageFullError } from "@/lib/mantencion/client/db"
import type { WorkshopEntry } from "@/lib/mantencion/client/fleet-view"
import { equipmentLabel } from "@/lib/mantencion/client/fleet-view"
import { formatDate, todayInChile } from "@/lib/utils"
import { useAppActions, useAppData } from "./app-context"
import { Sheet } from "./dialog"
import { FieldError, Label } from "./ui"

type Option = "sigue" | "salio"

/** «Actualizar estado»: sigue en taller (con el motivo) o ya salió (con la fecha). Se guarda en el teléfono y se envía solo. */
export function WorkshopSheet({ entry, onClose }: { entry: WorkshopEntry; onClose: () => void }) {
  const { account, deviceId, online } = useAppData()
  const { syncNow, toast } = useAppActions()
  const today = todayInChile()
  const [option, setOption] = useState<Option | null>(null)
  const [note, setNote] = useState("")
  const [exitDate, setExitDate] = useState(today)
  const [errors, setErrors] = useState<{ option?: string; note?: string; exitDate?: string; save?: string }>({})
  const [saving, setSaving] = useState(false)

  const days = entry.entryDate ? Math.max(0, daysBetween(entry.entryDate, today)) : null

  const save = async () => {
    const next: typeof errors = {}
    if (!option) next.option = "Elige una opción."
    if (option === "sigue" && note.trim().length < 3) next.note = "Explica por qué aún no sale."
    if (option === "salio" && (!exitDate || exitDate > today)) next.exitDate = "La fecha de salida no puede ser futura."
    if (option === "salio" && entry.entryDate && exitDate < entry.entryDate) next.exitDate = `No puede ser antes de que entró (${formatDate(entry.entryDate)}).`
    if (Object.keys(next).length > 0 || !option) { setErrors(next); return }

    const base = { id: crypto.randomUUID(), recordId: entry.recordId, createdAt: new Date().toISOString(), deviceId }
    const parsed = workshopUpdateSchema.safeParse(option === "sigue" ? { ...base, kind: "sigue", note: note.trim() } : { ...base, kind: "salio", exitDate })
    if (!parsed.success) { setErrors({ save: parsed.error.issues[0]?.message ?? "Revisa los datos." }); return }
    setSaving(true)
    try {
      await enqueueSimple(newWorkshopItem({
        authorUserId: account.userId,
        payload: parsed.data,
        summary: { vehicleId: entry.vehicleId, equipmentCode: entry.equipmentCode, equipmentPlate: entry.equipmentPlate },
      }))
      toast(online ? "Estado guardado. Enviando a la plataforma…" : "Estado guardado en el teléfono.")
      syncNow()
      onClose()
    } catch (cause) {
      setErrors({ save: cause instanceof StorageFullError ? cause.message : "No pudimos guardar el estado. Intenta de nuevo." })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet title="Estado del equipo" onClose={onClose}>
      <div>
        <div className="mono" style={{ fontWeight: 600 }}>{equipmentLabel({ code: entry.equipmentCode, plate: entry.equipmentPlate })}</div>
        <p className="hint">
          {entry.entryDate ? `En taller desde ${formatDate(entry.entryDate)}${days ? ` (${days} ${days === 1 ? "día" : "días"}).` : " (hoy)."}` : "En taller."}
        </p>
      </div>
      <div>
        <div className="seg" role="group" aria-label="Estado del equipo" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <button type="button" aria-pressed={option === "sigue"} onClick={() => { setOption("sigue"); setErrors({}) }}>Sigue en taller</button>
          <button type="button" aria-pressed={option === "salio"} onClick={() => { setOption("salio"); setErrors({}) }}>Ya salió</button>
        </div>
        <FieldError message={errors.option} />
      </div>
      {option === "sigue" ? (
        <div>
          <Label htmlFor="shnota">¿Por qué aún no sale?</Label>
          <textarea id="shnota" className={errors.note ? "inp bad" : "inp"} rows={3} value={note} placeholder="Ej: esperando repuesto" aria-invalid={Boolean(errors.note)} onChange={(event) => { setNote(event.target.value); setErrors({}) }} />
          <FieldError message={errors.note} />
        </div>
      ) : null}
      {option === "salio" ? (
        <div>
          <Label htmlFor="shsal">Salió de taller el</Label>
          <input id="shsal" type="date" className={errors.exitDate ? "inp bad" : "inp"} value={exitDate} max={today} min={entry.entryDate ?? undefined} aria-invalid={Boolean(errors.exitDate)} onChange={(event) => { setExitDate(event.target.value); setErrors({}) }} />
          <FieldError message={errors.exitDate} />
        </div>
      ) : null}
      <FieldError message={errors.save} />
      <button type="button" className="btnp" onClick={() => { void save() }} disabled={saving}>Guardar estado</button>
      <button type="button" className="btns wide" onClick={onClose}>Cancelar</button>
    </Sheet>
  )
}
