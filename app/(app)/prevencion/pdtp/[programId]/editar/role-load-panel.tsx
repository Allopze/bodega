"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Table, TableBody, TableCell, TableCellNum, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { computePdtpRoleLoad } from "@/lib/services/pdtp/role-load"
import { PersistedDetails } from "../../persisted-details"

/** Desde cuánta cantidad acumulada en una posición de semana (S1..S4, a
 *  través de todo el horizonte del programa) se resalta como carga alta.
 *  Es una señal para revisar, no un límite normativo. */
const WEEKLY_OVERLOAD_THRESHOLD = 10

/**
 * Carga de planificación por responsable, calculada EN EL CLIENTE sobre los
 * valores vivos de la matriz de planificación — incluidos los cambios que
 * todavía no se han guardado. No es una consulta al servidor: el padre
 * (`planificacion-tab.tsx`) le pasa exactamente lo que tiene en memoria en
 * ese momento (`rowStates` para las filas tocadas, la planificación guardada
 * para el resto).
 *
 * Una actividad con más de un responsable suma su cantidad planificada a
 * CADA responsable (ver `computePdtpRoleLoad`), así que la suma de la
 * columna "Total" de esta tabla, sumada entre todas las filas, casi siempre
 * será mayor que el total de ocurrencias del programa — no es un error, es
 * la naturaleza de "responsables" como conjunto, no como partición.
 */
export function RoleLoadPanel({ activities, cells, catalog }: {
  activities: Array<{ id: string; responsibleSlugs: unknown }>
  cells: Array<{ activityId: string; month: number; week: number; plannedQuantity: number }>
  catalog: Array<{ slug: string; displayName: string }>
}) {
  const rows = React.useMemo(() => computePdtpRoleLoad({
    activities: activities.map((activity) => ({
      id: activity.id,
      responsibleSlugs: Array.isArray(activity.responsibleSlugs) ? (activity.responsibleSlugs as string[]) : [],
    })),
    cells,
    catalog,
  }), [activities, cells, catalog])

  return (
    <PersistedDetails
      storageKey="planificacion-role-load"
      summary={<>
        <svg width="12" height="12" viewBox="0 0 12 12" className="shrink-0 rotate-0 transition-transform duration-200 group-open:rotate-90" aria-hidden>
          <path d="M4 2.5L8.5 6L4 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
        Carga por rol{rows.length > 0 ? ` (${rows.length})` : ""}
      </>}
    >
      <p className="mt-2 max-w-prose text-xs leading-5 text-[var(--color-text-muted)]">
        Calculado sobre la planificación en pantalla, incluidos los cambios sin guardar. Una actividad con más de un
        responsable suma su cantidad planificada a cada uno, así que el total de esta tabla no coincide con el total
        de ocurrencias del programa.
      </p>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-[var(--color-text-faint)]">Ninguna actividad tiene responsables asignados todavía.</p>
      ) : (
        <div className="mt-2">
          <TableRoot>
            <Table>
              <caption className="sr-only">Carga de planificación por responsable</caption>
              <TableHeader>
                <TableRow>
                  <TableHead>Responsable</TableHead>
                  <TableHead className="text-right">S1</TableHead>
                  <TableHead className="text-right">S2</TableHead>
                  <TableHead className="text-right">S3</TableHead>
                  <TableHead className="text-right">S4</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right" title="Actividades del programa que tienen a este responsable asignado, tengan o no planificación todavía">Activ.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.slug}>
                    <TableCell className="text-xs font-medium text-[var(--color-text)]">{row.displayName}</TableCell>
                    {row.weekly.map((value, index) => (
                      <TableCellNum
                        key={index}
                        className={cn("text-xs", value > WEEKLY_OVERLOAD_THRESHOLD && "font-semibold text-[var(--color-warning-ink)]")}
                        title={value > WEEKLY_OVERLOAD_THRESHOLD ? `Más de ${WEEKLY_OVERLOAD_THRESHOLD} ocurrencias acumuladas en esta semana del mes a través del año` : undefined}
                      >
                        {value || "—"}
                      </TableCellNum>
                    ))}
                    <TableCellNum className="text-xs font-semibold">{row.total}</TableCellNum>
                    <TableCellNum className="text-xs">{row.activityCount}</TableCellNum>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableRoot>
        </div>
      )}
    </PersistedDetails>
  )
}
