"use client"

import { exportBoardDataAction } from "@/app/(app)/chart-data-export-action"
import { useBoardTables } from "@/components/charts/board-tables"
import { Button } from "@/components/ui/button"
import { EXPORT_ICON, ExportButton } from "@/components/ui/export-button"

/**
 * «Exportar Excel» de la cabecera de un tablero (esqueleto común, crítica 2026-11-15): un libro con
 * todas las tablas «Ver datos» exportables de la pantalla, una hoja por gráfico, en el orden en que
 * aparecen, y el período y la faena en «Metadatos». Cada gráfico conserva su propio «Exportar Excel»
 * para bajar sólo esa tabla.
 *
 * Lo pone la página sólo si quien mira tiene el permiso de exportar del módulo. Mientras los gráficos
 * cargan (o si ninguno tiene datos) el botón queda deshabilitado en su lugar, sin aparecer de golpe.
 */
export function BoardExportButton({ title, scope, range }: {
  title: string
  /** Período y faena como los nombra la pantalla. */
  scope: Record<string, string>
  /** Fechas que mide el período, para «Período (desde/hasta)» de «Metadatos». */
  range?: { from: string; to: string }
}) {
  const tables = useBoardTables()

  if (tables.length === 0) {
    return (
      <Button variant="secondary" size="sm" disabled title="Ningún gráfico de la pantalla tiene datos que exportar">
        <EXPORT_ICON className="mr-1 h-4 w-4 shrink-0" />
        Exportar Excel
      </Button>
    )
  }

  return (
    <ExportButton
      action={exportBoardDataAction}
      filters={{
        title,
        scope,
        ...(range ? { range } : {}),
        tables: tables.map(({ title: tableTitle, headers, rows, permission, notes }) => ({
          title: tableTitle,
          headers,
          rows,
          permission,
          ...(notes && notes.length > 0 ? { notes: [...notes] } : {}),
        })),
      }}
      ariaLabel={`Exportar Excel: ${title}, una hoja por gráfico`}
    />
  )
}
