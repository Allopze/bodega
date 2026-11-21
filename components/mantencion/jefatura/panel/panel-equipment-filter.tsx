"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Combobox } from "@/components/ui/combobox"
import { vehicleFichaHref } from "@/lib/routing/vehicle-ficha"

/**
 * Filtro «Equipo» del Panel de mantención (`?equipo=`): el último escalón de Chome → faena → equipo. Elegir un
 * equipo acota las secciones que se miden por equipo y deja un enlace a su hoja de vida. Viaja en la URL y se
 * aplica al cambiar, con `router.replace` + `scroll: false` (patrón de filtros de AGENTS.md). Las opciones ya
 * vienen acotadas por el alcance y la faena elegida; la página valida además el valor de la URL.
 */
export function PanelEquipmentFilter({ options, value }: {
  options: ReadonlyArray<{ id: string; label: string }>
  /** Equipo elegido (ya validado contra el alcance), o `null`. */
  value: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = React.useTransition()

  function change(next: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (next) params.set("equipo", next)
    else params.delete("equipo")
    const query = params.toString()
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    })
  }

  if (options.length === 0) return null
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      <span id="panel-equipo-label" className="text-sm font-semibold text-[var(--color-text)]">Equipo</span>
      <Combobox
        options={options.map((option) => ({ value: option.id, label: option.label }))}
        value={value ?? ""}
        onChange={change}
        placeholder="Todos los equipos"
        clearLabel="Todos los equipos"
        aria-label="Equipo del Panel"
        className="w-full sm:w-72"
      />
      {value ? (
        <Link href={vehicleFichaHref(value, "mantencion")} className="text-xs font-semibold text-[var(--color-primary-ink)] hover:underline">
          Ver hoja de vida →
        </Link>
      ) : null}
    </div>
  )
}
