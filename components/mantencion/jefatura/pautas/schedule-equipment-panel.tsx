import Link from "next/link"
import { Button } from "@/components/ui/button"
import { plural } from "@/lib/mantencion/format"
import type { ScheduleEditorModel } from "@/lib/services/mantencion/schedules"
import { SectionCard } from "../shared/section-card"

/** Equipos activos que usan la pauta, por faena, con salida a «Equipos» filtrado por esta pauta. */
export function ScheduleEquipmentPanel({ scheduleId, equipment, onAssign }: {
  scheduleId: string
  equipment: ScheduleEditorModel["equipment"]
  onAssign: () => void
}) {
  return (
    <SectionCard
      title="Equipos con esta pauta"
      description={plural(equipment.total, "equipo activo", "equipos activos")}
      action={<Button variant="secondary" size="sm" onClick={onAssign}>Asignar equipos</Button>}
    >
      {equipment.total === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">Ningún equipo usa esta pauta todavía. Asígnalos para que el mecánico pueda registrarles preventivas.</p>
      ) : (
        <>
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-label="Equipos por faena">
            {equipment.byWorksite.map((site) => (
              <li key={site.worksiteId}>{site.worksiteName} <strong className="font-mono tabular-nums">{site.count}</strong></li>
            ))}
          </ul>
          <Link href={`/mantencion/equipos?pauta=${encodeURIComponent(scheduleId)}`} className="mt-3 inline-block text-sm font-semibold text-[var(--color-primary-ink)] hover:underline">
            Ver {equipment.total === 1 ? "el equipo" : `los ${equipment.total} equipos`} en Equipos
          </Link>
        </>
      )}
    </SectionCard>
  )
}
