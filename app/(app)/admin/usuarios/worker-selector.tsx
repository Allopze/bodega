"use client"

import { Field } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export interface WorkerOption {
  id: string
  name: string
  rut: string | null
  worksiteId: string
  worksiteName: string
  linkedUserId: string | null
}

interface WorkerSelectorProps {
  workers: WorkerOption[]
  selectedId: string
  currentUserId?: string
  onValueChange: (workerId: string) => void
  error?: string
}

export function WorkerSelector({ workers, selectedId, currentUserId, onValueChange, error }: WorkerSelectorProps) {
  return (
    <Field
      label="Trabajador asociado"
      htmlFor="workerId"
      helper="Opcional. Al seleccionarlo, se incorpora su faena al acceso del usuario."
      error={error}
    >
      <input type="hidden" name="workerId" value={selectedId} />
      <Select value={selectedId || "none"} onValueChange={(value) => onValueChange(value === "none" ? "" : value)}>
        <SelectTrigger id="workerId" error={!!error}>
          <SelectValue placeholder="Sin trabajador asociado" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Sin trabajador asociado</SelectItem>
          {workers.map((worker) => {
            const linkedElsewhere = !!worker.linkedUserId && worker.linkedUserId !== currentUserId
            return (
              <SelectItem key={worker.id} value={worker.id} disabled={linkedElsewhere}>
                {worker.name} · {worker.worksiteName}{worker.rut ? ` · ${worker.rut}` : ""}{linkedElsewhere ? " · ya asociado" : ""}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
    </Field>
  )
}
