"use client"

import { useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Combobox } from "@/components/ui/combobox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { normalizeMiperName } from "@/lib/prevention/miper/names"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import { hrefToEntry } from "@/lib/prevention/miper/workspace-url"
import type { MiperWorkspace } from "@/lib/services/miper/queries"
import { toast } from "@/lib/toast"
import { saveMiperEntryAction } from "../actions"

/**
 * «Nueva tarea» (spec §2.3): en el RE-04 una tarea sin riesgos no existe, así
 * que esto crea el PRIMER riesgo de la tarea y abre su editor. Si la actividad
 * ya existe, el riesgo se inserta después de su último N° para que el RE-04
 * exportado conserve la actividad contigua.
 */
export function NewTaskDialog({ open, onOpenChange, matrixId, rows, dictionaries }: {
  open: boolean; onOpenChange: (open: boolean) => void; matrixId: string; rows: readonly MiperEntrySnapshot[]; dictionaries: MiperWorkspace["dictionaries"]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [values, setValues] = useState({ activity: "", task: "", position: "", location: "", hazard: "" })
  const [busy, setBusy] = useState(false)
  const creatingRef = useRef(false)
  const set = (key: keyof typeof values) => (value: string) => setValues((current) => ({ ...current, [key]: value }))
  const ready = values.activity.trim() && values.task.trim() && values.position.trim()
  const field = (key: keyof typeof values, label: string, list: keyof MiperWorkspace["dictionaries"], required: boolean) => (
    <Field label={label} htmlFor={`miper-new-task-${key}`} required={required}>
      <Combobox id={`miper-new-task-${key}`} allowCustomValue options={dictionaries[list].map((value) => ({ value, label: value }))} value={values[key]} onChange={set(key)} placeholder="Escribe o elige…" />
    </Field>
  )
  async function create() {
    if (creatingRef.current) return
    creatingRef.current = true
    setBusy(true)
    try {
      const activityKey = normalizeMiperName(values.activity)
      const lastOfActivity = rows.filter((row) => normalizeMiperName(row.activity ?? "") === activityKey).reduce<number | null>((max, row) => (max === null || row.rowNumber > max ? row.rowNumber : max), null)
      const state = await saveMiperEntryAction({
        matrixId, insertAfterRowNumber: lastOfActivity,
        values: { activity: values.activity.trim(), task: values.task.trim(), position: values.position.trim(), location: values.location.trim() || null, hazard: values.hazard.trim() || null },
      })
      const id = (state.data as { id?: unknown } | undefined)?.id
      if (!state.ok || typeof id !== "string") { toast.error(state.message ?? "No se pudo crear la tarea."); return }
      onOpenChange(false)
      setValues({ activity: "", task: "", position: "", location: "", hazard: "" })
      router.push(hrefToEntry(pathname, params, id, "identificacion"))
    } catch {
      toast.error("No se pudo crear la tarea.")
    } finally {
      creatingRef.current = false
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva tarea</DialogTitle>
          <DialogDescription>Indica dónde ocurre y, si quieres, el primer peligro. Después se completa su evaluación.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          {field("activity", "Actividad", "activities", true)}
          {field("task", "Tarea", "tasks", true)}
          {field("position", "Puesto de trabajo", "positions", true)}
          {field("location", "Lugar específico", "locations", false)}
          <div className="md:col-span-2">{field("hazard", "Primer peligro", "hazards", false)}</div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={() => { void create() }} disabled={!ready} loading={busy}>Crear tarea</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
