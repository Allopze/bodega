import { plural } from "@/lib/mantencion/format"
import { EmptyState } from "@/components/ui/empty-state"
import { PanelBlock } from "@/components/ui/dashboard-panel"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow, TableRoot } from "@/components/ui/table"
import { checkAction } from "@/lib/services/mantencion/looker/filters"
import { matrixCellShort, matrixCellText } from "@/lib/services/mantencion/looker/preventive-summary"
import type { ChecklistMatrix, MatrixCheck } from "@/lib/services/mantencion/looker/types"
import { cn, formatDate } from "@/lib/utils"
import { FilterToggle } from "./filter-toggle"
import { MatrixPhotos } from "./matrix-photos"

const STATE_CLASS: Record<NonNullable<MatrixCheck["items"][string]> | "none", string> = {
  realizado: "border-[var(--color-success-line)] bg-[var(--color-success-tint)] text-[var(--color-success-ink)]",
  no_realizado: "border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] text-[var(--color-danger-ink)]",
  no_aplica: "border-[var(--color-border)] bg-[var(--color-surface-3)] text-[var(--color-text-muted)]",
  none: "border-transparent text-[var(--color-text-faint)]",
}

/**
 * Matriz ítem × mantención. Una columna por pauta (patente, fecha y nivel) y una fila por ítem.
 * La columna es el control de filtro: al pulsarla, la tabla de cumplimiento y las barras se
 * recalculan, pero la matriz se queda con todas sus columnas y resalta la elegida.
 *
 * R = realizado (verde), NR = no realizado (rojo), NA = no aplica (gris). El estado siempre se
 * escribe en el texto (`title`/`aria-label`), no se confía sólo al color.
 */
export function ChecklistMatrixView({
  matrix,
  selectedCheckId,
}: {
  matrix: ChecklistMatrix
  selectedCheckId: string | null
}) {
  if (matrix.checks.length === 0) {
    return (
      <PanelBlock padding="none">
        <div className="p-5">
          <h3 className="text-eyebrow text-[var(--color-text)]">Matriz de checklist</h3>
        </div>
        <EmptyState
          compact
          title="No hay pautas con detalle por ítem en este período"
          description={matrix.withoutDetail > 0
            ? `${matrix.withoutDetail} de las últimas pautas no traen el detalle por ítem. Se incorpora al reimportar el consolidado.`
            : "Prueba con otro período o quita algún filtro."}
        />
      </PanelBlock>
    )
  }

  return (
    <PanelBlock padding="none">
      <div className="border-b border-[var(--color-border)] px-4 py-3 md:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="text-eyebrow text-[var(--color-text)]">Matriz de checklist</h3>
          <p className="font-mono text-2xs tabular-nums text-[var(--color-text-muted)]">{plural(matrix.items.length, "ítem", "ítems")} · {plural(matrix.checks.length, "pauta", "pautas")}</p>
        </div>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          R = realizado · NR = no realizado · NA = no aplica. Cada columna es una mantención; cada fila, un ítem de la pauta.
        </p>
        {matrix.withoutDetail > 0 && (
          <p className="mt-1 text-xs text-[var(--color-warning-ink)]">
            {matrix.withoutDetail} de las últimas pautas no traen detalle por ítem y no se muestran como columna.
          </p>
        )}
      </div>
      <TableRoot framed={false} stickyHeader aria-label="Matriz de checklist de pautas">
        <Table className="min-w-max text-xs">
          <TableCaption className="sr-only">Matriz de checklist de pautas</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 z-20 min-w-44 bg-(--color-surface-2)">Ítem</TableHead>
              {matrix.checks.map((check) => {
                const active = selectedCheckId === check.id
                return (
                  <TableHead key={check.id} className={cn("min-w-40 align-top", active && "bg-[var(--color-primary-tint)]")}>
                    <FilterToggle
                      action={checkAction(check.id, active)}
                      className="flex-col items-start gap-0.5 px-0 py-0 text-left"
                    >
                      <span className="font-mono text-xs font-semibold">{check.code || check.plate || "Equipo"}</span>
                      <span className="text-2xs font-normal text-[var(--color-text-muted)]">{formatDate(check.date)} · {check.level}</span>
                      <span className="text-2xs font-normal text-[var(--color-text-subtle)]">{check.mechanic ?? "Sin mecánico"}</span>
                    </FilterToggle>
                    <MatrixPhotos photos={check.photoIds} links={check.photoUrls} equipment={check.code || check.plate} />
                  </TableHead>
                )
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {matrix.items.map((item) => (
              <TableRow key={item.name}>
                <TableCell className="sticky left-0 z-10 min-w-44 bg-(--color-surface) py-2">
                  <span className="block text-xs text-[var(--color-text)]">{item.name}</span>
                  {item.group && <span className="block text-2xs text-[var(--color-text-subtle)]">{item.group}</span>}
                </TableCell>
                {matrix.checks.map((check) => {
                  const state = check.items[item.name]
                  const tone = state ?? "none"
                  return (
                    <TableCell key={check.id} className="py-2 text-center">
                      <span
                        role="img"
                        aria-label={`${item.name}: ${matrixCellText(state)}`}
                        title={matrixCellText(state)}
                        className={cn(
                          "inline-flex h-6 min-w-7 items-center justify-center rounded-[4px] border px-1 font-mono text-2xs font-semibold",
                          STATE_CLASS[tone],
                        )}
                      >
                        {matrixCellShort(state)}
                      </span>
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableRoot>
      <div className="border-t border-[var(--color-border)] px-4 py-3 md:px-5">
        <h4 className="text-eyebrow text-[var(--color-text)]">Observaciones</h4>
        {matrix.checks.some((check) => check.observations) ? (
          <ul className="mt-1.5 space-y-1">
            {matrix.checks.filter((check) => check.observations).map((check) => (
              <li key={check.id} className="text-xs text-[var(--color-text)]">
                <span className="font-mono text-2xs text-[var(--color-text-muted)]">{check.code || check.plate} · {formatDate(check.date)}</span>{" "}
                {check.observations}
              </li>
            ))}
          </ul>
        ) : <p className="mt-1 text-xs text-[var(--color-text-muted)]">Sin observaciones en las pautas mostradas.</p>}
      </div>
    </PanelBlock>
  )
}
