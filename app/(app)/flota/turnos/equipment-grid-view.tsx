import type { ReactNode } from "react"
import Link from "next/link"
import { VehicleIdentity } from "@/components/fleet/vehicle-identity"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Table, TableBody, TableCell, TableCellNum, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { vehicleFichaHref } from "@/lib/routing/vehicle-ficha"
import type { GridCell, getEquipmentGridView } from "@/lib/services/fleet-shifts-views"
import { cn, formatDate, formatQty } from "@/lib/utils"
import { DAY_MARK_LABEL } from "./day-mark-control"
import { formatHoursValue, formatIdlePct, formatTargetPct } from "./format"
import { IdleTargetForm } from "./idle-target-form"

type GridView = Awaited<ReturnType<typeof getEquipmentGridView>>

/** Desde cuántas veces la meta una celda pasa de «sobre la meta» a «muy sobre la meta». */
const FAR_OVER_FACTOR = 1.5

const CELL_BOX = "flex h-8 min-w-9 items-center justify-center rounded-[var(--radius-sm)] px-1 text-xs font-medium tabular-nums"
const NEUTRAL_CELL = "bg-[var(--color-surface-3)] text-[var(--color-text-muted)]"
// Superficie -tint con texto -ink: los tokens base no alcanzan contraste como texto (AGENTS, regla 8).
const BAND = {
  ok: "bg-[var(--color-success-tint)] text-[var(--color-success-ink)]",
  over: "bg-[var(--color-warning-tint)] text-[var(--color-warning-ink)]",
  farOver: "bg-[var(--color-danger-tint)] text-[var(--color-danger-ink)]",
}

function bandOf(pct: number, target: number): keyof typeof BAND {
  if (pct <= target) return "ok"
  return pct <= target * FAR_OVER_FACTOR ? "over" : "farOver"
}

/** Qué dice y cómo se pinta una celda de la grilla. El color nunca va solo: siempre hay un valor o una sigla. */
function cellView(cell: GridCell, target: number): { text: string; className: string; title: string } {
  switch (cell.kind) {
    case "pct": {
      const pct = cell.pct ?? 0
      return {
        text: String(Math.round(pct * 100)),
        className: BAND[bandOf(pct, target)],
        title: `${formatIdlePct(pct)} de ralentí · ${formatHoursValue(cell.engineHours)} h de motor`,
      }
    }
    case "detenido": return { text: "–", className: "text-[var(--color-text-muted)]", title: "Motor detenido ese día" }
    case "sin_dato": return { text: "s/d", className: "text-[var(--color-text-muted)]", title: `${formatHoursValue(cell.engineHours)} h de motor, sin dato de ralentí: el equipo no distingue ralentí de trabajo` }
    case "fs": return { text: "FS", className: NEUTRAL_CELL, title: "Fuera de servicio o en mantención" }
    case "sp": return { text: "SP", className: "bg-[var(--color-info-tint)] text-[var(--color-info-ink)]", title: "Sin operación programada" }
    case "uso_personal": return { text: "UP", className: NEUTRAL_CELL, title: "Uso personal: el día no cuenta en las horas ni en el ralentí" }
    case "ss": return { text: "SS", className: "bg-[var(--color-signal-tint)] text-[var(--color-signal-ink)]", title: "Sin señal: el equipo no transmite desde antes de ese día" }
    default: return { text: "", className: "", title: "Sin telemetría ese día" }
  }
}

const DAY_HEAD = "px-0.5 py-2 text-center"
const STICKY_FIRST = "sticky left-0 z-10 bg-[var(--color-surface)]"

function DayHeads({ days }: { days: string[] }) {
  return days.map((day) => (
    <TableHead key={day} className={DAY_HEAD} aria-label={formatDate(day)}>
      <span className="block text-xs tabular-nums" aria-hidden="true">{day.slice(8)}</span>
      <span className="block text-2xs font-normal text-[var(--color-text-subtle)]" aria-hidden="true">{day.slice(5, 7)}</span>
    </TableHead>
  ))
}

function Legend({ target }: { target: number }) {
  const items: Array<{ box: string; sample: string; text: string }> = [
    { box: BAND.ok, sample: "12", text: `en meta (hasta ${formatTargetPct(target)})` },
    { box: BAND.over, sample: "38", text: `sobre la meta` },
    { box: BAND.farOver, sample: "55", text: `muy sobre la meta (más de ${formatTargetPct(target * FAR_OVER_FACTOR)})` },
    { box: "text-[var(--color-text-muted)]", sample: "–", text: "motor detenido" },
    { box: "text-[var(--color-text-muted)]", sample: "s/d", text: "con motor, sin dato de ralentí" },
    { box: NEUTRAL_CELL, sample: "FS", text: "fuera de servicio o en mantención" },
    { box: "bg-[var(--color-info-tint)] text-[var(--color-info-ink)]", sample: "SP", text: "sin operación programada" },
    { box: NEUTRAL_CELL, sample: "UP", text: "uso personal (no cuenta en los totales)" },
    { box: "bg-[var(--color-signal-tint)] text-[var(--color-signal-ink)]", sample: "SS", text: "sin señal (no transmite hace días)" },
    { box: "border border-dashed border-[var(--color-border-strong)]", sample: "", text: "vacío: sin telemetría o sin datos" },
  ]
  return (
    <ul aria-label="Leyenda de la grilla" className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-[var(--color-text-muted)]">
      {items.map((item) => (
        <li key={item.text} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={cn(CELL_BOX, "h-6 min-w-7", item.box)}>{item.sample}</span>
          <span>{item.text}</span>
        </li>
      ))}
    </ul>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-2">
      <h2 id={id} className="text-sm font-semibold text-[var(--color-text)]">{title}</h2>
      {children}
    </section>
  )
}

/**
 * Vista «Equipos»: grilla equipo × día con el % de ralentí del día completo (00–24 h), los días detenidos, los
 * litros en vacío por día y los ajustes. Las tablas desplazan dentro de su caja, nunca la página. Es un
 * componente de servidor: sólo la meta (`IdleTargetForm`) es interactiva.
 */
export function EquipmentGridView({ grid, canManage, dayHref }: { grid: GridView; canManage: boolean; dayHref: string }) {
  const { target, days, rows, stoppedDays, idleLiters } = grid

  if (rows.length === 0) {
    return (
      <div className="space-y-6">
        <div className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)]">
          <EmptyState
            title="No hay equipos que mostrar en este período"
            description="Aparecen los equipos con VisionLink de tus faenas y los que tengan turnos o marcas en el período."
            action={<Button asChild variant="secondary"><Link href={dayHref}>Ir a los turnos del día</Link></Button>}
          />
        </div>
        {canManage && <IdleTargetSection target={target} />}
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <Section id="turnos-grilla" title="Ralentí por equipo y día">
        <Legend target={target} />
        <TableRoot aria-label="Grilla de % de ralentí por equipo y día" stickyHeader>
          <Table className="w-max min-w-full">
            <TableHeader>
              <TableRow>
                <TableHead className={cn(STICKY_FIRST, "bg-[var(--color-surface-2)]")}>Equipo</TableHead>
                <DayHeads days={days} />
                <TableHead className="text-right">Motor h</TableHead>
                <TableHead className="text-right">% período</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.vehicleId}>
                  <TableCell className={cn(STICKY_FIRST, "py-1.5")}>
                    <VehicleIdentity code={row.vehicleCode} href={vehicleFichaHref(row.vehicleId)} />
                  </TableCell>
                  {row.cells.map((cell) => {
                    const view = cellView(cell, target)
                    return (
                      <TableCell key={cell.day} className="px-0.5 py-1.5 text-center" title={view.title}>
                        <span className={cn(CELL_BOX, view.className)}>{view.text}</span>
                      </TableCell>
                    )
                  })}
                  <TableCellNum className="py-1.5">{formatHoursValue(row.engineHours)}</TableCellNum>
                  <TableCellNum className="py-1.5">{formatIdlePct(row.idlePct)}</TableCellNum>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableRoot>
      </Section>

      <Section id="turnos-detenidos" title="Días detenidos">
        {stoppedDays.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">Ningún equipo estuvo en mantención, fuera de servicio ni con marca de día en este período.</p>
        ) : (
          <TableRoot aria-label="Días detenidos por equipo">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Equipo</TableHead>
                  <TableHead>Día</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Origen</TableHead>
                  <TableHead>Notas</TableHead>
                  <TableHead className="text-right">Motor h</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stoppedDays.map((stopped) => (
                  <TableRow key={`${stopped.vehicleCode}|${stopped.day}|${stopped.source}`}>
                    <TableCell><span className="font-mono text-sm font-medium">{stopped.vehicleCode}</span></TableCell>
                    <TableCell nowrap>{formatDate(stopped.day)}</TableCell>
                    <TableCell>{DAY_MARK_LABEL[stopped.label] ?? stopped.label}</TableCell>
                    <TableCell>{stopped.source === "estado" ? "Estado del equipo" : "Marca del día"}</TableCell>
                    <TableCell className="max-w-xs">{stopped.notes || "—"}</TableCell>
                    <TableCellNum>{formatHoursValue(stopped.engineHours)}</TableCellNum>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableRoot>
        )}
      </Section>

      <Section id="turnos-litros" title="Litros en vacío por día">
        {idleLiters.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">VisionLink no informó litros en este período.</p>
        ) : (
          <TableRoot aria-label="Litros en vacío por equipo y día" stickyHeader>
            <Table className="w-max min-w-full">
              <TableHeader>
                <TableRow>
                  <TableHead className={cn(STICKY_FIRST, "bg-[var(--color-surface-2)]")}>Equipo</TableHead>
                  <DayHeads days={days} />
                  <TableHead className="text-right">Litros en vacío</TableHead>
                  <TableHead className="text-right">Litros totales</TableHead>
                  <TableHead className="text-right">% en vacío</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {idleLiters.map((row) => (
                  <TableRow key={row.vehicleCode}>
                    <TableCell className={cn(STICKY_FIRST, "py-1.5")}><span className="font-mono text-sm font-medium">{row.vehicleCode}</span></TableCell>
                    {days.map((day) => {
                      const liters = row.byDay[day]
                      return (
                        <TableCell key={day} className="px-0.5 py-1.5 text-center font-mono text-xs tabular-nums" title={formatDate(day)}>
                          {liters === null || liters === undefined ? "" : formatQty(liters, undefined, { maximumFractionDigits: 0 })}
                        </TableCell>
                      )
                    })}
                    <TableCellNum className="py-1.5">{formatQty(row.idleLiters, undefined, { maximumFractionDigits: 0 })}</TableCellNum>
                    <TableCellNum className="py-1.5">{formatQty(row.totalLiters, undefined, { maximumFractionDigits: 0 })}</TableCellNum>
                    <TableCellNum className="py-1.5">{formatIdlePct(row.idleShare)}</TableCellNum>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableRoot>
        )}
      </Section>

      <p className="text-xs text-[var(--color-text-muted)]">
        % y horas: tramos de VisionLink. Litros: resumen diario de VisionLink.
      </p>

      {canManage && <IdleTargetSection target={target} />}
    </div>
  )
}

function IdleTargetSection({ target }: { target: number }) {
  return (
    <Section id="turnos-ajustes" title="Ajustes">
      <IdleTargetForm target={target} />
    </Section>
  )
}
