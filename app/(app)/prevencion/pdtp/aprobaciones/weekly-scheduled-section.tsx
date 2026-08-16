import Link from "next/link"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import type { PdtpPendingTarget } from "@/lib/services/prevention-pdtp"

/**
 * Actividades calendarizadas con plan esta semana que todavía no registran
 * ejecución.
 *
 * Vivía en `/pdtp/obligaciones`, que es la pantalla de las actividades **no**
 * calendarizadas (`on_demand`/`triggered`) — justo lo contrario. Se movió acá,
 * junto a las ejecuciones pendientes de aprobar, que es el resto del trabajo
 * calendarizado abierto.
 */
export function WeeklyScheduledSection({ targets }: { targets: PdtpPendingTarget[] }) {
  return (
    <section id="programadas-semana" className="mt-6 scroll-mt-4">
      <h2 className="text-sm font-semibold text-[var(--color-text)]">Programadas esta semana</h2>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">Actividades calendarizadas con plan esta semana que aún no registran ejecución.</p>
      {targets.length === 0 ? (
        <EmptyState compact title="Sin pendientes calendarizados" description="No hay actividades programadas sin ejecutar para las faenas visibles." />
      ) : (
        <div className="mt-3 divide-y divide-[var(--color-border)] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          {targets.map((target) => (
            <div key={target.worksiteId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[var(--color-text)]">{target.worksiteName}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{target.activityIds.length} actividad(es) sin ejecutar esta semana</p>
              </div>
              <Button asChild size="sm" variant="secondary">
                <Link href={`/prevencion/pdtp?faena=${target.worksiteId}`}>Ver programa</Link>
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
