"use client"

/**
 * TIUX-14 / TIUX-39 — filtros de la lista de entregas, sincronizados con la URL
 * (`?estado=vigentes`, `?acuse=pendiente`, `?prestamo=vencido`, `?faena=<id>`).
 *
 * Son filtros y no navegación: se aplican con `router.replace(url, { scroll:
 * false })` para no llenar el historial ni devolver al usuario al inicio de la
 * página, y los botones usan `aria-pressed` (vía `SegmentedControl` en modo
 * `onClick`) en vez de los `aria-current="page"` que tenían los enlaces.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const ALL = "_all"

export function AssignmentFilters({ worksites, counts }: {
  worksites: { id: string; name: string }[]
  counts: { pendingAcceptance: number; overdueLoans: number }
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const onlyActive = searchParams.get("estado") === "vigentes"
  const pendingAcceptance = searchParams.get("acuse") === "pendiente"
  const overdueLoans = searchParams.get("prestamo") === "vencido"
  const worksiteId = searchParams.get("faena") ?? ""

  /** `null` quita el parámetro. Conserva el resto (columnas y orden de la tabla viajan en la URL). */
  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  const hasExtraFilters = pendingAcceptance || overdueLoans || Boolean(worksiteId)

  return (
    <div className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-3">
      <SegmentedControl
        ariaLabel="Estado de la custodia"
        items={[
          { key: "todas", label: "Todas", active: !onlyActive, onClick: () => update({ estado: null }) },
          { key: "vigentes", label: "Vigentes", active: onlyActive, onClick: () => update({ estado: "vigentes" }) },
        ]}
      />
      <SegmentedControl
        ariaLabel="Entregas que piden una acción"
        items={[
          {
            key: "acuse",
            label: `Sin acuse aún (${counts.pendingAcceptance})`,
            active: pendingAcceptance,
            onClick: () => update({ acuse: pendingAcceptance ? null : "pendiente" }),
          },
          {
            key: "vencidos",
            label: `Préstamos vencidos (${counts.overdueLoans})`,
            active: overdueLoans,
            onClick: () => update({ prestamo: overdueLoans ? null : "vencido" }),
          },
        ]}
      />
      <div className="w-full sm:w-56">
        <Select value={worksiteId || ALL} onValueChange={(value) => update({ faena: value === ALL ? null : value })}>
          <SelectTrigger aria-label="Faena">
            <SelectValue placeholder="Todas las faenas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas las faenas</SelectItem>
            {worksites.map((worksite) => <SelectItem key={worksite.id} value={worksite.id}>{worksite.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {hasExtraFilters && (
        <Button type="button" variant="link" size="sm" onClick={() => update({ acuse: null, prestamo: null, faena: null })}>
          Limpiar filtros
        </Button>
      )}
    </div>
  )
}
