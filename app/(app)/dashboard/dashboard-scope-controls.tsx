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
 *
 * Ninguno lleva etiqueta visible: "Todas las faenas" y "Mes" se describen
 * solos, y las dos etiquetas gastaban una línea de chrome cada una (además de
 * no coincidir entre sí — una en versal-baja y la otra en mayúsculas). El
 * nombre accesible va en `aria-label`.
 */
export function DashboardScopeControls({
  scope,
  worksites,
  allWorksitesLabel,
}: {
  scope: DashboardScope
  /** Faenas activas autorizadas, no sólo las que tienen trabajo pendiente. */
  worksites: ReadonlyArray<{ id: string; name: string }>
  /**
   * Rótulo de la opción "todas". Absorbe el rótulo de alcance que antes vivía
   * en una línea aparte del header y repetía palabra por palabra el valor del
   * select. La única vez que aportaba algo era cuando "todas" **no** son todas
   * —un rol con faenas acotadas—, y eso es exactamente esta etiqueta.
   */
  allWorksitesLabel: string
}) {
  const router = useRouter()
  /*
   * `useTransition` y no un `useState` propio: el estado a mano se ponía en
   * `true` al elegir faena y **nadie lo bajaba nunca**. La navegación es un
   * `replace` sobre el mismo segmento, así que el componente no se desmonta ni
   * pierde su estado — el selector quedaba `disabled` para siempre y no se podía
   * volver a cambiar de faena sin recargar. React limpia el pendiente cuando la
   * transición termina, que es justo el hecho que el `disabled` quiere reflejar.
   */
  const [pending, startTransition] = React.useTransition()

  // Un rol de faena única no tiene nada que elegir: el selector sería un control
  // de una sola opción. El período se muestra siempre.
  const showWorksitePicker = worksites.length > 1

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {showWorksitePicker && (
        <WorksiteSelect
          worksites={worksites as Array<{ id: string; name: string }>}
          value={scope.worksiteId}
          includeAll
          allValue={ALL_WORKSITES}
          allLabel={allWorksitesLabel}
          disabled={pending}
          aria-label="Faena del tablero"
          // `w-` explícito y no `min-w-`: `SelectTrigger` trae `w-full`, que
          // dentro del `<label className="grid">` de antes se limitaba a la
          // columna, pero como hijo directo de un flex se estiraba a toda la
          // fila — se comía la línea y empujaba el período abajo. `twMerge`
          // resuelve el conflicto a favor de esta clase.
          triggerClassName="h-11 sm:h-9 w-[13rem] text-[13px]"
          onChange={(value) => {
            // `WorksiteSelect` emite `""` al elegir "todas", no `allValue`.
            // Sin normalizarlo, `dashboardScopeHref` lo trata como una faena y
            // deja un `?faena=` vacío colgando en la URL.
            startTransition(() => {
              router.replace(dashboardScopeHref(scope, { worksiteId: value || ALL_WORKSITES }), { scroll: false })
            })
          }}
        />
      )}

      <SegmentedControl
        variant="segmented"
        ariaLabel="Período del tablero"
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
