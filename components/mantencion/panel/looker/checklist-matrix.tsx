import Link from "next/link"
import { Funnel } from "@phosphor-icons/react/dist/ssr"
import { plural } from "@/lib/mantencion/format"
import { EmptyState } from "@/components/ui/empty-state"
import { PanelBlock } from "@/components/ui/dashboard-panel"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow, TableRoot } from "@/components/ui/table"
import { checkAction } from "@/lib/services/mantencion/looker/filter-hrefs"
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
 * La patente de la columna abre la ficha del equipo directamente en esa pauta (`hrefForCheck`); el embudo de
 * al lado filtra el panel por la pauta (`x_check`): la tabla de cumplimiento y las barras se recalculan, pero la
 * matriz se queda con todas sus columnas y resalta la elegida. Son dos controles distintos a propósito.
 *
 * R = realizado (verde), NR = no realizado (rojo), NA = no aplica (gris). El estado siempre se
 * escribe en el texto (`title`/`aria-label`), no se confía sólo al color.
 */
export function ChecklistMatrixView({
  matrix,
  selectedCheckId,
  hrefForCheck,
}: {
  matrix: ChecklistMatrix
  selectedCheckId: string | null
  /** Enlace a la ficha del equipo de la pauta; `null` si la pauta no tiene equipo vinculado. */
  hrefForCheck: (check: MatrixCheck) => string | null
}) {
  if (matrix.checks.length === 0) {
    return (
      <PanelBlock span="full" padding="none">
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
    <PanelBlock span="full" padding="none">
      <div className="border-b border-[var(--color-border)] px-4 py-3 md:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-xs text-[var(--color-text-muted)]">R = realizado · NR = no realizado · NA = no aplica · — = el ítem no está en esa pauta.</p>
          <p className="font-mono text-2xs tabular-nums text-[var(--color-text-muted)]">{plural(matrix.items.length, "ítem", "ítems")} · {plural(matrix.checks.length, "pauta", "pautas")}</p>
        </div>
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
                const href = hrefForCheck(check)
                // La patente, como en las tablas del panel; el código si el equipo no la tiene.
                const name = check.plate || check.code || "Equipo"
                return (
                  <TableHead key={check.id} className={cn("min-w-40 align-top", active && "bg-[var(--color-primary-tint)]")}>
                    <span className="flex items-start gap-1">
                      <span className="min-w-0">
                        {href ? (
                          <Link
                            href={href}
                            scroll={false}
                            title={`Ver la pauta del ${formatDate(check.date)} de ${name}`}
                            className="inline-flex min-h-8 items-center rounded-[var(--radius-xs)] font-mono text-xs font-semibold text-[var(--color-primary-ink)] underline decoration-[var(--color-primary-line)] underline-offset-2 hover:decoration-[var(--color-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
                          >
                            {name}
                          </Link>
                        ) : <span className="inline-flex min-h-8 items-center font-mono text-xs font-semibold">{name}</span>}
                        <span className="block text-2xs font-normal text-[var(--color-text-muted)]">{formatDate(check.date)} · {check.level}</span>
                        <span className="block text-2xs font-normal text-[var(--color-text-subtle)]">{check.mechanic ?? "Sin mecánico"}</span>
                      </span>
                      <FilterToggle
                        action={checkAction(check.id, active)}
                        aria-label={`Filtrar el panel por la pauta del ${formatDate(check.date)} de ${name}`}
                        className="min-h-11 min-w-11 shrink-0 justify-center text-[var(--color-text-muted)] sm:min-h-8 sm:min-w-8"
                      >
                        <Funnel size={14} weight="bold" aria-hidden />
                      </FilterToggle>
                    </span>
                    <MatrixPhotos photos={check.photoIds} links={check.photoUrls} equipment={check.plate || check.code} />
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
        <h3 className="text-eyebrow text-[var(--color-text)]">Observaciones</h3>
        {matrix.checks.some((check) => check.observations) ? (
          <ul className="mt-1.5 space-y-1">
            {matrix.checks.filter((check) => check.observations).map((check) => (
              <li key={check.id} className="text-xs text-[var(--color-text)]">
                <span className="font-mono text-2xs text-[var(--color-text-muted)]">{check.plate || check.code} · {formatDate(check.date)}</span>{" "}
                {check.observations}
              </li>
            ))}
          </ul>
        ) : <p className="mt-1 text-xs text-[var(--color-text-muted)]">Sin observaciones en las pautas mostradas.</p>}
      </div>
    </PanelBlock>
  )
}
