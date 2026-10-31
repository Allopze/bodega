"use client"

import { Field } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface Option { id: string; name: string }

/**
 * Faena y punto de carga: el paso 1 del registro. La selección vive en la URL
 * (`?faena=&punto=`) porque los equipos que se ofrecen en el paso siguiente
 * dependen de la faena; quien aloja este selector la escribe con `replace`.
 */
export function RegistrarPicker({
  worksites,
  points,
  worksiteId,
  pointId,
  onChange,
  errors = {},
}: {
  worksites: Option[]
  points: Array<Option & { worksiteId: string }>
  worksiteId: string
  pointId: string
  onChange: (selection: { worksiteId: string; pointId: string }) => void
  errors?: { worksiteId?: string; pointId?: string }
}) {
  const worksitePoints = points.filter((point) => point.worksiteId === worksiteId)

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Faena" htmlFor="registrar-faena" error={errors.worksiteId}>
        <Select
          value={worksiteId}
          onValueChange={(value) => {
            // Un único punto activo en la faena queda elegido solo.
            const only = points.filter((point) => point.worksiteId === value)
            onChange({ worksiteId: value, pointId: only.length === 1 ? only[0]!.id : "" })
          }}
        >
          <SelectTrigger id="registrar-faena"><SelectValue placeholder="Elige la faena" /></SelectTrigger>
          <SelectContent>{worksites.map((worksite) => <SelectItem key={worksite.id} value={worksite.id}>{worksite.name}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label="Punto de carga" htmlFor="registrar-punto" error={errors.pointId}>
        <Select value={pointId} onValueChange={(value) => onChange({ worksiteId, pointId: value })} disabled={!worksiteId}>
          <SelectTrigger id="registrar-punto">
            <SelectValue placeholder={worksiteId && worksitePoints.length === 0 ? "Esta faena no tiene puntos activos" : "Elige el punto"} />
          </SelectTrigger>
          <SelectContent>{worksitePoints.map((point) => <SelectItem key={point.id} value={point.id}>{point.name}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
    </div>
  )
}
