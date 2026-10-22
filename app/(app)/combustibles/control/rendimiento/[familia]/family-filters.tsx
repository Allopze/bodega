"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { Combobox } from "@/components/ui/combobox"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"

const ALL = "_all"

export interface FamilyFiltersProps {
  media: Array<{ id: string; name: string }>
  vehicles: Array<{ plate: string; code: string | null; brand: string | null; model: string | null }>
}

/**
 * Filtros propios de las vistas de rendimiento (R-01): tipo de rendimiento,
 * medio de suministro, equipo y rango de fechas. Todo en la URL. El equipo se
 * elige de la lista de equipos de la familia (no es un cuadro de texto libre: el
 * texto de búsqueda de la página lo da la barra superior). Un rango de fechas
 * reemplaza al año y los meses.
 */
export function FamilyFilters({ media, vehicles }: FamilyFiltersProps) {
  const searchParams = useSearchParams()
  const { setFilter, setFilters } = useUrlFilters({ pageKey: "pagina", resetPageKeys: ["cargas"] })

  const unit = searchParams.get("unidad") ?? ALL
  const medium = searchParams.get("medio") ?? ALL
  const equipment = searchParams.get("equipo") ?? ""
  const from = searchParams.get("desde") ?? ""
  const to = searchParams.get("hasta") ?? ""

  const equipmentOptions = React.useMemo(
    () => vehicles.map((vehicle) => ({
      value: vehicle.plate,
      label: vehicle.code ? `${vehicle.code} · ${vehicle.plate}` : vehicle.plate,
      hint: [vehicle.brand, vehicle.model].filter(Boolean).join(" "),
    })),
    [vehicles],
  )

  return (
    <>
      <Select value={unit} onValueChange={(value) => setFilter("unidad", value === ALL ? null : value)}>
        <SelectTrigger className="w-44" aria-label="Tipo de rendimiento">
          <SelectValue placeholder="Todos los rendimientos" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos los rendimientos</SelectItem>
          <SelectItem value="km_per_liter">km/L (odómetro)</SelectItem>
          <SelectItem value="liters_per_hour">L/h (horómetro)</SelectItem>
        </SelectContent>
      </Select>
      <Select value={medium} onValueChange={(value) => setFilter("medio", value === ALL ? null : value)}>
        <SelectTrigger className="w-48" aria-label="Medio de suministro">
          <SelectValue placeholder="Todos los medios" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos los medios</SelectItem>
          {media.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Combobox
        options={equipmentOptions}
        value={equipment}
        onChange={(value) => setFilter("equipo", value || null)}
        placeholder="Equipo (código o patente)"
        clearLabel="Todos los equipos"
        aria-label="Equipo"
        className="w-56"
      />
      <DateRangePicker
        className="w-full gap-2 sm:w-80"
        fromValue={from}
        toValue={to}
        onFromChange={(iso) => setFilters({ desde: iso || null, meses: iso ? null : searchParams.get("meses") })}
        onToChange={(iso) => setFilters({ hasta: iso || null, meses: iso ? null : searchParams.get("meses") })}
        fromPlaceholder="Desde"
        toPlaceholder="Hasta"
      />
    </>
  )
}
