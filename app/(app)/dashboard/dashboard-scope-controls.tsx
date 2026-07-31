"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { WorksiteSelect } from "@/components/ui/worksite-select"
import {
  ALL_WORKSITES,
  DASHBOARD_PERIODS,
  dashboardScopeHref,
  type DashboardScope,
} from "./dashboard-scope"

/**
 * Los dos únicos filtros del dashboard: faena y período. Reencuadran **todo** el
 * tablero, no una lista.
 *
 * Antes había tres controles (faena, orden y el botón de limpiar) y ninguno
 * reencuadraba nada: el de faena filtraba en el cliente las 12 filas de la cola
 * mientras los KPIs, las alertas, la tarjeta PDTP y los gráficos lo ignoraban.
 *
 * El período son `Link` (`SegmentedControl`), así que navega sin una línea de
 * cliente. La faena necesita `router.replace` porque `WorksiteSelect` es un
 * `Select` con `onChange`; `replace` y no `push` para no llenar el historial de
 * pasos intermedios al comparar faenas.
 */
export function DashboardScopeControls({
  scope,
  worksites,
}: {
  scope: DashboardScope
  /** Faenas activas autorizadas, no sólo las que tienen trabajo pendiente. */
  worksites: ReadonlyArray<{ id: string; name: string }>
}) {
  const router = useRouter()
  const [pending, setPending] = React.useState(false)

  // Un rol de faena única no tiene nada que elegir: el selector sería un control
  // de una sola opción. El período se muestra siempre.
  const showWorksitePicker = worksites.length > 1

  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
      {showWorksitePicker && (
        <label className="grid min-w-0 gap-1 text-xs font-semibold text-[var(--color-text-muted)]">
          Faena
          <WorksiteSelect
            worksites={worksites as Array<{ id: string; name: string }>}
            value={scope.worksiteId}
            includeAll
            allValue={ALL_WORKSITES}
            allLabel="Todas las faenas"
            disabled={pending}
            aria-label="Faena del tablero"
            triggerClassName="h-11 sm:h-9 min-w-[13rem] text-[13px]"
            onChange={(value) => {
              setPending(true)
              // `WorksiteSelect` emite `""` al elegir "todas", no `allValue`.
              // Sin normalizarlo, `dashboardScopeHref` lo trata como una faena y
              // deja un `?faena=` vacío colgando en la URL.
              router.replace(dashboardScopeHref(scope, { worksiteId: value || ALL_WORKSITES }), { scroll: false })
            }}
          />
        </label>
      )}

      <SegmentedControl
        variant="segmented"
        ariaLabel="Período del tablero"
        eyebrow="Período"
        items={DASHBOARD_PERIODS.map((period) => ({
          key: period.value,
          label: period.label,
          href: dashboardScopeHref(scope, { period: period.value }),
          active: scope.period === period.value,
        }))}
      />
    </div>
  )
}
