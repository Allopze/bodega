import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { DetailItem } from "@/components/ui/detail-item"
import { Callout } from "@/components/ui/callout"
import { formatReading, plural, recordKindText, remainingText, unitName } from "@/lib/mantencion/format"
import { formatDate } from "@/lib/utils"
import { SectionCard } from "../shared/section-card"
import { EquipmentStateBadge } from "../shared/equipment-state-badge"
import type { EquipmentDetailData } from "./equipment-detail-types"

/** Estado de mantención del equipo: lectura, próxima mantención y última preventiva. */
export function EquipmentStatusCard({ data }: { data: EquipmentDetailData }) {
  const { status, unit } = data
  const last = status.lastPreventive
  return (
    <SectionCard title="Mantención">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <EquipmentStateBadge state={status.state} />
        {data.workshop && <Badge variant="outline" size="sm">En taller</Badge>}
      </div>
      {data.workshop && (
        <Callout tone="warning" className="mb-3">
          En taller{data.workshop.entryDate ? ` desde el ${formatDate(data.workshop.entryDate)}` : ""}
          {data.workshop.daysStopped ? ` · ${plural(data.workshop.daysStopped, "día detenido", "días detenido")}` : ""}
          {data.workshop.stale ? " · sin actualizar" : ""}.
        </Callout>
      )}
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <DetailItem layout="stacked" mono label="Última lectura" value={status.currentReading ? `${formatReading(status.currentReading.value, unit)} · ${formatDate(status.currentReading.date)}` : null} />
        <DetailItem layout="stacked" mono label="Próxima mantención" value={status.nextReading != null ? formatReading(status.nextReading, unit) : null} />
        <DetailItem layout="stacked" label="Diferencia" value={status.remaining != null ? remainingText(status, unit) : null} />
        <DetailItem layout="stacked" label="Intervalo que toca" value={status.nextIntervalValue != null ? formatReading(status.nextIntervalValue, unit) : null} />
        <DetailItem layout="stacked" label="Última preventiva" value={last ? `${recordKindText("P", last.intervalValue, unit)} · ${formatDate(last.date)}` : null} />
      </dl>
    </SectionCard>
  )
}

/** Ficha del equipo en modo lectura. Si el código y la patente coinciden se muestra uno solo (regla 16). */
export function EquipmentFichaCard({ data, canSeeSchedules }: { data: EquipmentDetailData; canSeeSchedules: boolean }) {
  const samePlate = data.noPlate || data.plate === data.code
  return (
    <SectionCard title="Ficha">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <DetailItem layout="stacked" mono label="Código interno" value={data.code} />
        {!samePlate && <DetailItem layout="stacked" mono label="Patente" value={data.plate} />}
        {data.noPlate && <DetailItem layout="stacked" label="Patente" value="Sin patente" muted />}
        <DetailItem layout="stacked" label="Tipo" value={`${data.typeName} · se mide en ${unitName(data.unit)}`} />
        <DetailItem layout="stacked" label="Marca" value={data.brandName} />
        <DetailItem layout="stacked" label="Modelo" value={data.model} />
        <DetailItem layout="stacked" label="Año" value={data.year} />
        <DetailItem layout="stacked" label="Faena" value={data.worksiteName} />
        <DetailItem
          layout="stacked"
          label="Pauta"
          value={data.schedule
            ? (canSeeSchedules
              ? <Link href={`/mantencion/pautas/${data.schedule.id}`} className="text-[var(--color-primary-ink)] underline-offset-2 hover:underline">{data.schedule.name}</Link>
              : data.schedule.name)
            : <span className="text-[var(--color-text-muted)]">Sin pauta</span>}
        />
        <DetailItem layout="stacked" mono label="Lectura inicial" value={data.initialReading ? `${formatReading(data.initialReading.value, data.unit)} · ${formatDate(data.initialReading.date)}` : null} />
        <DetailItem layout="stacked" label="Estado" value={data.retired ? `Dado de baja${data.retiredReason ? ` · ${data.retiredReason}` : ""}` : "Activo"} />
      </dl>
    </SectionCard>
  )
}
