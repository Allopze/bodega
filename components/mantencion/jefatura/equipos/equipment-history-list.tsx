import type { EquipmentHistoryEntry } from "@/lib/services/mantencion/equipment-history"
import { formatDateTime } from "@/lib/utils"
import { SectionCard } from "../shared/section-card"

/** Historial de cambios de la ficha: fecha y autor en una línea y, debajo, qué se hizo. */
export function EquipmentHistoryList({ entries }: { entries: EquipmentHistoryEntry[] }) {
  return (
    <SectionCard title="Historial de cambios" description="Quién cambió qué en la ficha">
      {entries.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">Todavía no hay cambios registrados.</p>
      ) : (
        <ol className="divide-y divide-[var(--color-border)]">
          {entries.map((entry) => (
            <li key={entry.id} className="py-2.5">
              <p className="font-mono text-xs text-[var(--color-text-muted)]">
                {formatDateTime(entry.createdAt)} · {entry.userName ?? "Sistema"}
              </p>
              <p className="mt-0.5 text-sm text-[var(--color-text)]">{entry.summary}</p>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  )
}
