import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { formatReading, plural, recordKindText } from "@/lib/mantencion/format"
import type { RecentEquipmentRecord } from "@/lib/services/mantencion/equipment"
import { formatDate } from "@/lib/utils"
import { SectionCard } from "../shared/section-card"

/** Registros más recientes del equipo, dentro de lo que la persona puede ver; cada uno enlaza a su detalle. */
export function EquipmentRecentRecords({ records, total, code }: { records: RecentEquipmentRecord[]; total: number; code: string }) {
  return (
    <SectionCard
      title="Registros"
      description={`${plural(total, "registro recibido", "registros recibidos")}`}
      action={total > records.length
        ? <Link href={`/mantencion/registros?equipo=${encodeURIComponent(code)}`} className="text-xs font-semibold text-[var(--color-primary-ink)] hover:underline">Ver todos</Link>
        : undefined}
    >
      {records.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">Aún no tiene registros. Llegan desde la app del mecánico cuando firma una mantención.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {records.map((record) => (
            <li key={record.id}>
              <Link href={`/mantencion/registros/${record.id}`} className="flex items-start justify-between gap-3 rounded-md py-2.5 hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-primary)]">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[var(--color-text)]">{recordKindText(record.kind, record.intervalValue, record.unit)}</span>
                  <span className="block font-mono text-xs text-[var(--color-text-muted)]">{formatReading(record.reading, record.unit)} · {record.folio ?? "Sin folio"}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-mono text-xs text-[var(--color-text-muted)]">{formatDate(record.workDate)}</span>
                  {record.voided && <Badge variant="outline" size="sm">Anulado</Badge>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}
