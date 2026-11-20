"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Combobox } from "@/components/ui/combobox"
import { Field } from "@/components/ui/field"

/**
 * Filtro de equipo del ranking de operadores (`?equipo=`): un filtro estructurado de la página, no un buscador
 * de texto. Aplica al elegir, con `router.replace` y sin mover el scroll.
 */
export function EquipmentFilter({ vehicleId, vehicles }: { vehicleId: string; vehicles: Array<{ id: string; code: string }> }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = React.useTransition()
  const options = React.useMemo(() => vehicles.map((vehicle) => ({ value: vehicle.id, label: vehicle.code })), [vehicles])

  function choose(next: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (next) params.set("equipo", next)
    else params.delete("equipo")
    const query = params.toString()
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }))
  }

  return (
    <Field label="Equipo" htmlFor="turnos-filtro-equipo" className="w-full sm:w-64">
      <Combobox
        id="turnos-filtro-equipo"
        options={options}
        value={vehicleId}
        onChange={choose}
        placeholder="Todos los equipos"
        clearLabel="Todos los equipos"
      />
    </Field>
  )
}
