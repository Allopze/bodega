"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { Combobox } from "@/components/ui/combobox"
import { Label } from "@/components/ui/field"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { WorksiteSelect } from "@/components/ui/worksite-select"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"

const ALL = "_all"
/** Filtros propios de la vista: se borran todos con «Quitar filtros». El período vive en la cabecera y no se toca. */
const MANAGED_KEYS = ["faena", "mandante", "unidad", "medio", "equipo"] as const

interface Option { id: string; name: string }

export interface FamilyFiltersProps {
  worksites: Option[]
  mandantes: Option[]
  media: Option[]
  vehicles: Array<{ plate: string; code: string | null; brand: string | null; model: string | null }>
}

const UNIT_LABELS: Record<string, string> = { km_per_liter: "km/L (odómetro)", liters_per_hour: "L/h (horómetro)" }

/**
 * Filtros del rendimiento (A2): faena y mandante a la vista, y «Más filtros»
 * con el tipo de rendimiento, el medio de suministro y el equipo; cada filtro
 * activo queda como chip removible bajo la barra. Todo en la URL, para poder
 * compartir la vista. El equipo se elige de la lista de equipos de la familia
 * (no es texto libre). El período ya no vive aquí: lo elige el control de la
 * cabecera y «Quitar filtros» no lo toca.
 */
export function FamilyFilters({ worksites, mandantes, media, vehicles }: FamilyFiltersProps) {
  const searchParams = useSearchParams()
  // `cargas` es la página del detalle de cargas: cambiar un filtro la vuelve a la primera.
  const { setFilter, setFilters, isPending } = useUrlFilters({ pageKey: "pagina", resetPageKeys: ["cargas"] })

  const worksite = searchParams.get("faena") ?? ""
  const mandante = searchParams.get("mandante") ?? ""
  const unit = searchParams.get("unidad") ?? ""
  const medium = searchParams.get("medio") ?? ""
  const equipment = searchParams.get("equipo") ?? ""

  const equipmentOptions = React.useMemo(
    () => vehicles.map((vehicle) => ({
      value: vehicle.plate,
      label: vehicle.code ? `${vehicle.code} · ${vehicle.plate}` : vehicle.plate,
      hint: [vehicle.brand, vehicle.model].filter(Boolean).join(" "),
    })),
    [vehicles],
  )

  const chips: ActiveFilterChip[] = []
  if (worksite) chips.push({ key: "faena", label: "Faena", value: worksite, displayValue: worksites.find((item) => item.id === worksite)?.name ?? worksite })
  if (mandante) chips.push({ key: "mandante", label: "Mandante", value: mandante, displayValue: mandantes.find((item) => item.id === mandante)?.name ?? mandante })
  if (unit) chips.push({ key: "unidad", label: "Rendimiento", value: unit, displayValue: UNIT_LABELS[unit] ?? unit })
  if (medium) chips.push({ key: "medio", label: "Medio", value: medium, displayValue: media.find((item) => item.id === medium)?.name ?? medium })
  if (equipment) chips.push({ key: "equipo", label: "Equipo", value: equipment, displayValue: equipmentOptions.find((option) => option.value === equipment)?.label ?? equipment })
  const secondaryActive = [unit, medium, equipment].filter(Boolean).length

  return (
    <div aria-busy={isPending || undefined}>
      <FilterToolbar
        activeChips={chips}
        onRemoveChip={(key) => setFilter(key, null)}
        onClearAll={() => setFilters(Object.fromEntries(MANAGED_KEYS.map((key) => [key, null])))}
        hasActiveFilters={chips.length > 0}
        activeCount={secondaryActive}
        overflowTitle="Más filtros de rendimiento"
        overflowDescription="Tipo de rendimiento, medio de suministro y equipo. Se suman a la faena y al mandante."
        overflowFilters={
          <>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs" id="rend-unidad-label">Tipo de rendimiento</Label>
              <Select value={unit || ALL} onValueChange={(value) => setFilter("unidad", value === ALL ? null : value)}>
                <SelectTrigger aria-labelledby="rend-unidad-label"><SelectValue placeholder="Todos los rendimientos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todos los rendimientos</SelectItem>
                  <SelectItem value="km_per_liter">{UNIT_LABELS.km_per_liter}</SelectItem>
                  <SelectItem value="liters_per_hour">{UNIT_LABELS.liters_per_hour}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs" id="rend-medio-label">¿Por dónde llegó el combustible?</Label>
              <Select value={medium || ALL} onValueChange={(value) => setFilter("medio", value === ALL ? null : value)}>
                <SelectTrigger aria-labelledby="rend-medio-label"><SelectValue placeholder="Todos los medios" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todos los medios</SelectItem>
                  {media.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs" htmlFor="rend-equipo">Equipo</Label>
              <Combobox
                id="rend-equipo"
                options={equipmentOptions}
                value={equipment}
                onChange={(value) => setFilter("equipo", value || null)}
                placeholder="Código o patente"
                clearLabel="Todos los equipos"
                aria-label="Equipo"
              />
            </div>
          </>
        }
      >
        <WorksiteSelect
          worksites={worksites}
          value={worksite}
          onChange={(value) => setFilter("faena", value || null)}
          triggerClassName="w-56"
        />
        {mandantes.length > 0 ? (
          <Select value={mandante || ALL} onValueChange={(value) => setFilter("mandante", value === ALL ? null : value)}>
            <SelectTrigger className="w-56" aria-label="Mandante"><SelectValue placeholder="Todos los mandantes" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los mandantes</SelectItem>
              {mandantes.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : null}
      </FilterToolbar>
    </div>
  )
}
