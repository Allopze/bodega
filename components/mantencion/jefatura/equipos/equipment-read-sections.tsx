import type { ReactNode } from "react"
import Link from "next/link"
import { DetailItem } from "@/components/ui/detail-item"
import { formatReading, recordKindText, remainingText, unitName } from "@/lib/mantencion/format"
import { formatDate } from "@/lib/utils"
import { SectionCard } from "../shared/section-card"
import { EquipmentStateBadge } from "../shared/equipment-state-badge"
import type { EquipmentDetailData } from "./equipment-detail-types"

/**
 * Un tramo que no se parte a la mitad: una fecha («29-10-↵2026») o una lectura
 * («120.100 ↵km») cortadas por el ancho de la columna se leen como dos datos.
 */
function NoBreak({ children }: { children: ReactNode }) {
  return <span className="whitespace-nowrap">{children}</span>
}

/** Un valor con su fecha debajo, en mono y entera: «120.100 km» / «29-10-2026». */
function ValueOnDate({ value, date }: { value: ReactNode; date: string }) {
  return (
    <>
      {value}
      <span className="block whitespace-nowrap font-mono text-xs font-normal tabular-nums text-[var(--color-text-muted)]">{formatDate(date)}</span>
    </>
  )
}

/**
 * Lo que dice la correctiva abierta además de la etiqueta «En taller · N días»:
 * desde cuándo y cuándo fue la última novedad. «Sin actualizar» va en el naranja
 * de pendientes, en el tono de texto (C4), y dice qué falta.
 */
function WorkshopNote({ workshop }: { workshop: NonNullable<EquipmentDetailData["workshop"]> }) {
  return (
    <p className="mb-3 text-sm text-[var(--color-text-muted)]">
      {workshop.entryDate ? <>Entró a taller el <NoBreak>{formatDate(workshop.entryDate)}</NoBreak>. </> : "Sin fecha de ingreso a taller. "}
      {workshop.stale
        ? <span className="font-semibold text-[var(--color-signal-ink)]">Sin actualizar: la última novedad es del <NoBreak>{formatDate(workshop.lastActivityDate)}</NoBreak>.</span>
        : <>Última novedad el <NoBreak>{formatDate(workshop.lastActivityDate)}</NoBreak>.</>}
    </p>
  )
}

/** Estado de mantención del equipo: lectura, próxima mantención y última preventiva. */
export function EquipmentStatusCard({ data }: { data: EquipmentDetailData }) {
  const { status, unit } = data
  const last = status.lastPreventive
  return (
    <SectionCard title="Mantención">
      <div className="mb-3">
        {/* Sin fecha de ingreso (`daysStopped` nulo) no hay cuántos días decir: la etiqueta cae en «desde hoy». */}
        <EquipmentStateBadge state={status.state} workshop={data.workshop ? { days: data.workshop.daysStopped ?? null } : null} />
      </div>
      {data.workshop && <WorkshopNote workshop={data.workshop} />}
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <DetailItem layout="stacked" mono label="Última lectura" value={status.currentReading ? <ValueOnDate value={<NoBreak>{formatReading(status.currentReading.value, unit)}</NoBreak>} date={status.currentReading.date} /> : null} />
        <DetailItem layout="stacked" mono label="Próxima mantención" value={status.nextReading != null ? <NoBreak>{formatReading(status.nextReading, unit)}</NoBreak> : null} />
        <DetailItem layout="stacked" label="Diferencia" value={status.remaining != null ? remainingText(status, unit) : null} />
        <DetailItem layout="stacked" label="Intervalo que toca" value={status.nextIntervalValue != null ? formatReading(status.nextIntervalValue, unit) : null} />
        <DetailItem
          layout="stacked"
          label="Última preventiva"
          value={last ? <ValueOnDate value={recordKindText("P", last.intervalValue, unit)} date={last.date} /> : null}
        />
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
              // Objetivo táctil de 44 px en móvil; en escritorio la línea normal.
              ? <Link href={`/mantencion/pautas/${data.schedule.id}`} className="inline-flex min-h-11 items-center text-[var(--color-primary-ink)] underline-offset-2 hover:underline sm:min-h-0">{data.schedule.name}</Link>
              : data.schedule.name)
            : <span className="text-[var(--color-text-muted)]">Sin pauta</span>}
        />
        <DetailItem layout="stacked" mono label="Lectura inicial" value={data.initialReading ? <ValueOnDate value={<NoBreak>{formatReading(data.initialReading.value, data.unit)}</NoBreak>} date={data.initialReading.date} /> : null} />
        <DetailItem layout="stacked" label="Estado" value={data.retired ? `Dado de baja${data.retiredReason ? ` · ${data.retiredReason}` : ""}` : "Activo"} />
      </dl>
    </SectionCard>
  )
}
