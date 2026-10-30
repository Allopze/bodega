import Link from "next/link"
import { Warning } from "@phosphor-icons/react/dist/ssr"
import { Badge } from "@/components/ui/badge"
import { Callout } from "@/components/ui/callout"
import { DetailItem } from "@/components/ui/detail-item"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { executorText, formatHours, formatNumber, formatReading, plural } from "@/lib/mantencion/format"
import type { RecordDetail } from "@/lib/services/mantencion/records-detail"
import { formatDate, formatDateTime } from "@/lib/utils"
import { SectionCard } from "../shared/section-card"
import { recordAlertTags } from "./record-alerts"

const GRID = "grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3"

const ALERT_LINK = "inline-flex min-h-11 items-center font-medium underline underline-offset-2 sm:min-h-6"

/**
 * Alertas del registro: un solo aviso con una entrada por alerta, en tipo
 * oración. Cada una dice qué pasó y por qué importa, qué hacer y lleva al dato
 * (la foto, las lecturas) o al registro que la explica. Todo es texto visible:
 * nada vive sólo en un `title`.
 */
export function RecordAlerts({ detail }: { detail: RecordDetail }) {
  const tags = recordAlertTags(detail)
  if (tags.length === 0) return null
  return (
    <Callout
      tone="warning"
      icon={<Warning size={18} weight="fill" />}
      // Con una sola alerta, su propio titular ya dice todo: un encabezado encima lo repetiría.
      title={tags.length > 1 ? `Este registro tiene ${tags.length} alertas` : undefined}
      className="mb-4"
    >
      <ul aria-label="Alertas del registro" className="divide-y divide-[var(--color-warning-line)]">
        {tags.map((tag) => (
          <li key={tag.key} className="py-2.5 first:pt-1 last:pb-0">
            <p className="font-semibold">{tag.title}</p>
            <p className="mt-0.5">{tag.message}</p>
            <p className="mt-0.5">{tag.action}</p>
            {tag.anchor && <a href={tag.anchor.href} className={ALERT_LINK}>{tag.anchor.label}</a>}
            {tag.linkTo && (
              <Link href={`/mantencion/registros/${tag.linkTo.id}`} className={ALERT_LINK}>
                Ver {tag.linkTo.folio ?? "la preventiva anterior"}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Callout>
  )
}

export function EquipmentSection({ detail }: { detail: RecordDetail }) {
  const equipment = detail.equipment
  const plate = equipment.noPlate || equipment.plate === equipment.code ? "Sin patente" : equipment.plate
  return (
    <div id="equipo" className="scroll-mt-4">
      <SectionCard title="Equipo" description="Tal como estaba en la ficha cuando se firmó; editar la ficha después no cambia este registro.">
        <dl className={GRID}>
          <DetailItem layout="stacked" label="Código" value={equipment.code} mono />
          <DetailItem layout="stacked" label="Patente" value={plate} mono />
          <DetailItem layout="stacked" label="Tipo" value={equipment.type} />
          <DetailItem layout="stacked" label="Marca y modelo" value={[equipment.brand, equipment.model].filter(Boolean).join(" ") || null} />
          <DetailItem layout="stacked" label="Año" value={equipment.year ? String(equipment.year) : null} mono />
          <DetailItem layout="stacked" label="Faena" value={detail.worksiteName} />
        </dl>
      </SectionCard>
    </div>
  )
}

export function RecordDataSection({ detail }: { detail: RecordDetail }) {
  const manual = !!detail.schedule && detail.schedule.intervalValue !== detail.schedule.suggestedIntervalValue
  const proxy = detail.executorKind !== "yo"
  return (
    <div id="datos-del-registro" className="scroll-mt-4">
      <SectionCard title="Datos del registro">
        <dl className={GRID}>
          <DetailItem layout="stacked" label="Fecha del trabajo" value={formatDate(detail.workDate)} mono />
          <DetailItem layout="stacked" label="Hecho por" value={detail.executorName} />
          <DetailItem layout="stacked" label="Registrado por" value={detail.registeredByName} />
          <DetailItem layout="stacked" label="Lectura" value={formatReading(detail.reading, detail.unit)} mono />
          <DetailItem
            layout="stacked"
            label="Lectura anterior"
            value={detail.previousReading ? `${formatReading(detail.previousReading.value, detail.unit)} · ${formatDate(detail.previousReading.date)}` : null}
            mono
          />
          <DetailItem layout="stacked" label="Firmado en el teléfono" value={formatDateTime(detail.signedAt)} mono />
          <DetailItem
            layout="stacked"
            label="Recibido en la plataforma"
            value={
              <>
                {formatDateTime(detail.receivedAt)}
                {detail.offlineSince && <span className="block text-xs font-normal text-[var(--color-text-muted)]">Sin señal desde {formatDateTime(detail.offlineSince)}</span>}
              </>
            }
            mono
          />
          {detail.schedule && (
            <DetailItem
              layout="stacked"
              label="Pauta usada"
              value={
                <>
                  {detail.schedule.name} · {formatReading(detail.schedule.intervalValue, detail.unit)}
                  <span className="block text-xs font-normal text-[var(--color-text-muted)]">
                    Versión {detail.schedule.version} de la pauta
                    {manual && ` · elegida a mano (la sugerida era la de ${formatReading(detail.schedule.suggestedIntervalValue, detail.unit)})`}
                  </span>
                </>
              }
            />
          )}
        </dl>
        {proxy && (
          <p className="mt-4 rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text)]">
            {executorText({ executorKind: detail.executorKind, registeredByName: detail.registeredByName, executorName: detail.executorName })}
          </p>
        )}
      </SectionCard>
    </div>
  )
}

export function PreventiveSection({ detail }: { detail: RecordDetail }) {
  const all = detail.groups.flatMap((group) => group.items)
  const done = all.filter((item) => item.value === "R").length
  const notDone = all.filter((item) => item.value === "NR").length
  const notApplicable = all.filter((item) => item.value === "NA").length
  return (
    <>
      <SectionCard
        title="Resultado de la pauta"
        description={`${formatNumber(done)} realizados · ${formatNumber(notDone)} no realizados · ${formatNumber(notApplicable)} no aplica`}
      >
        {/* Sin marco propio dentro de la tarjeta (el borde ya es el de la tarjeta). */}
        <TableRoot aria-label="Resultado de la pauta por sistema" className="rounded-none border-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Sistema</TableHead>
                <TableHead>Realizados</TableHead>
                <TableHead>Detalle</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.groups.map((group) => {
                const groupDone = group.items.filter((item) => item.value === "R").length
                const missing = group.items.filter((item) => item.value === "NR")
                const skipped = group.items.filter((item) => item.value === "NA")
                const warned = group.items.filter((item) => item.manufacturerWarning)
                return (
                  <TableRow key={group.name}>
                    <TableCell className="font-semibold">{group.name}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-[13px] tabular-nums">{groupDone} de {group.items.length}</TableCell>
                    <TableCell className="text-[var(--color-text-muted)]">
                      {missing.length === 0 && skipped.length === 0 && warned.length === 0 && "Sin novedad"}
                      {missing.length > 0 && (
                        <p className="text-[var(--color-text)]">
                          <strong className="font-semibold text-[var(--color-signal-ink)]">No realizado:</strong>{" "}
                          {missing.map((item) => `${item.name} — ${item.reason ?? "sin motivo"}`).join("; ")}
                        </p>
                      )}
                      {skipped.length > 0 && <p>No aplica: {skipped.map((item) => item.name).join(", ")}</p>}
                      {warned.length > 0 && <p>Confirmar con la pauta del fabricante: {warned.map((item) => item.name).join(", ")}</p>}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableRoot>
      </SectionCard>
      <SectionCard title="Notas del mecánico">
        <p className="whitespace-pre-wrap text-sm text-[var(--color-text)]">{detail.notes ?? "—"}</p>
      </SectionCard>
    </>
  )
}

export function CorrectiveSections({ detail }: { detail: RecordDetail }) {
  const corrective = detail.corrective
  if (!corrective) return null
  const workshop = corrective.workshop
  return (
    <>
      <SectionCard title="Trabajo realizado">
        <dl className={GRID}>
          <DetailItem layout="stacked" label="Cambio de aceite" value={corrective.oils.length ? corrective.oils.join(", ") : "No se cambió aceite"} />
          {corrective.workOrder && <DetailItem layout="stacked" label="Orden de trabajo" value={corrective.workOrder} mono />}
        </dl>
        <p className="mt-4 whitespace-pre-wrap text-sm text-[var(--color-text)]">{corrective.description}</p>
      </SectionCard>

      <SectionCard title="Trabajos y repuestos">
        <ul className="divide-y divide-[var(--color-border)] text-sm">
          {corrective.jobs.map((job) => (
            <li key={job.id} className="py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{job.workTypeName}</span>
                <span className="font-mono tabular-nums">{formatHours(job.hours)}</span>
              </div>
              {job.parts.length === 0 ? (
                <p className="mt-1 text-[var(--color-text-muted)]">No se usaron repuestos.</p>
              ) : (
                <ul className="mt-1">
                  {job.parts.map((part, index) => (
                    <li key={index} className="flex gap-3 py-0.5">
                      <span className="w-16 shrink-0 text-right font-mono tabular-nums">{formatNumber(part.quantity)} ×</span>
                      <span>{part.description}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-2 flex justify-between border-t border-[var(--color-border)] pt-2 text-sm font-medium">
          <span>Total de horas</span>
          <span className="font-mono tabular-nums">{formatHours(corrective.hours)}</span>
        </p>
      </SectionCard>

      <SectionCard title="Taller">
        <dl className={GRID}>
          <DetailItem layout="stacked" label="Entró a taller" value={corrective.workshopEntryDate ? formatDate(corrective.workshopEntryDate) : "No pasó por taller"} mono />
          <DetailItem
            layout="stacked"
            label="Salida de taller"
            value={workshop ? (workshop.inWorkshop ? <span className="text-[var(--color-signal-ink)]">Aún en taller</span> : workshop.exitDate ? formatDate(workshop.exitDate) : null) : null}
            mono
          />
          <DetailItem
            layout="stacked"
            label="Días detenido"
            value={workshop?.daysStopped != null ? plural(workshop.daysStopped, "día", "días") : null}
            mono
          />
          {corrective.workshopReason && <DetailItem layout="stacked" label="Motivo de seguir en taller" value={corrective.workshopReason} />}
        </dl>
        {workshop?.inWorkshop && workshop.stale && (
          <p className="mt-3 text-sm font-medium text-[var(--color-signal-ink)]">Sin actualizar hace más de 2 días.</p>
        )}
        {corrective.updates.length > 0 && (
          <ul className="mt-4 divide-y divide-[var(--color-border)] text-sm">
            {corrective.updates.map((update) => (
              <li key={update.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
                <span>
                  {update.kind === "salio"
                    ? <><strong className="font-semibold">Salió de taller</strong> el {update.exitDate ? formatDate(update.exitDate) : "—"}</>
                    : <><strong className="font-semibold">Sigue en taller:</strong> {update.note}</>}
                  <span className="block text-[var(--color-text-muted)]">{update.userName}</span>
                </span>
                <time className="font-mono text-xs tabular-nums text-[var(--color-text-muted)]">{formatDateTime(update.createdAt)}</time>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Conductores de las últimas 24 h">
        {corrective.drivers.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">Sin conductores declarados.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {corrective.drivers.map((name) => <li key={name}><Badge variant="outline" size="lg">{name}</Badge></li>)}
          </ul>
        )}
      </SectionCard>
    </>
  )
}
