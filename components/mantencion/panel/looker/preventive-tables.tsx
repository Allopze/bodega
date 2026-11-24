import { plural } from "@/lib/mantencion/format"
import { EmptyState } from "@/components/ui/empty-state"
import { PanelBlock } from "@/components/ui/dashboard-panel"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow, TableRoot } from "@/components/ui/table"
import { equipmentAction } from "@/lib/services/mantencion/looker/filters"
import type { ComplianceByPlate } from "@/lib/services/mantencion/looker/types"
import { ComplianceBar } from "./compliance-bar"
import { CrossFilterRow } from "./cross-filter-row"
import { FilterToggle } from "./filter-toggle"

/**
 * Cumplimiento por patente. El clic en la patente filtra la matriz y las barras, no esta tabla:
 * la consulta que la alimenta ignora `x_equipo`, así que siguen viéndose todas las patentes.
 */
export function ComplianceByPlateTable({
  rows,
  selectedId,
  title,
  note,
}: {
  rows: ComplianceByPlate[]
  selectedId: string | null
  title: string
  note: string
}) {
  return (
    <PanelBlock padding="none">
      <div className="border-b border-[var(--color-border)] px-4 py-3 md:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="text-eyebrow text-[var(--color-text)]">{title}</h3>
          <p className="font-mono text-2xs tabular-nums text-[var(--color-text-muted)]">{plural(rows.length, "patente", "patentes")}</p>
        </div>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">{note}</p>
      </div>
      {rows.length === 0 ? (
        <EmptyState compact title="Sin pautas en el período" description="Prueba con otro período o quita algún filtro." />
      ) : (
        <TableRoot framed={false}>
          <Table>
            <TableCaption className="sr-only">Cumplimiento por patente</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Patente</TableHead>
                <TableHead>Código</TableHead>
                <TableHead>Nivel de pauta</TableHead>
                <TableHead className="w-48">Cumplimiento</TableHead>
                <TableHead className="text-right">Pautas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const action = equipmentAction(row.vehicleId ?? "", selectedId === row.vehicleId)
                const content = (
                  <>
                    <TableCell nowrap>
                      {row.vehicleId ? (
                        <FilterToggle action={action} className="font-mono text-xs font-semibold" title={`${row.plate || row.code} · ${row.worksiteName ?? "Sin faena"}`}>
                          {row.plate || row.code || "—"}
                        </FilterToggle>
                      ) : <span className="font-mono text-xs" title={row.worksiteName ?? undefined}>{row.plate || row.code || "—"}</span>}
                    </TableCell>
                    <TableCell nowrap className="font-mono text-xs">{row.code || "—"}</TableCell>
                    <TableCell className="max-w-52 truncate text-xs" title={row.levels.join(" · ")}>{row.levels.join(" · ") || "—"}</TableCell>
                    <TableCell><ComplianceBar value={row.percent} digits={0} /></TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{row.checks}</TableCell>
                  </>
                )
                return row.vehicleId ? (
                  <CrossFilterRow key={row.vehicleId} action={action} active={selectedId === row.vehicleId}>
                    {content}
                  </CrossFilterRow>
                ) : (
                  <TableRow key={`${row.code}-${row.plate}`}>{content}</TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableRoot>
      )}
    </PanelBlock>
  )
}
