"use client"

import { FilePdf } from "@phosphor-icons/react"
import { exportPanelBoardAction } from "@/app/(app)/mantencion/panel/actions"
import { useBoardTables } from "@/components/charts/board-tables"
import { Button } from "@/components/ui/button"
import { EXPORT_ICON, ExportButton } from "@/components/ui/export-button"

/**
 * «Exportar Excel» del Panel de mantención: el libro del tablero (una hoja por gráfico) más la hoja «Trabajos»
 * con cada trabajo del período (la arma el servidor, ver `exportPanelBoardAction`). Mientras los gráficos
 * cargan, o si ninguno tiene datos, queda deshabilitado en su lugar. Es una acción de página: va en
 * `PageHeader.actions`.
 */
export function PanelExcelButton({ title, scope, range, faena, equipo }: {
  title: string
  scope: Record<string, string>
  range: { from: string; to: string }
  faena: string | null
  equipo: string | null
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
      action={exportPanelBoardAction}
      filters={{
        title,
        scope,
        range,
        filters: { from: range.from, to: range.to, faena, equipo },
        tables: tables.map(({ title: tableTitle, headers, rows, permission, notes }) => ({
          title: tableTitle,
          headers,
          rows,
          permission,
          ...(notes && notes.length > 0 ? { notes: [...notes] } : {}),
        })),
      }}
      ariaLabel={`Exportar Excel: ${title}, una hoja por gráfico y la hoja Trabajos`}
    />
  )
}

/**
 * «Exportar PDF»: el informe del Panel para la faena, el equipo y el período elegidos. Es un enlace de
 * descarga (GET) que resuelve el navegador; el servidor vuelve a exigir `mant:export` y el alcance.
 */
export function PanelPdfLink({ from, to, faena, equipo }: { from: string; to: string; faena: string | null; equipo: string | null }) {
  const params = new URLSearchParams({ desde: from, hasta: to })
  if (faena) params.set("faena", faena)
  if (equipo) params.set("equipo", equipo)
  return (
    <Button variant="secondary" size="sm" asChild>
      <a href={`/mantencion/informe/pdf?${params.toString()}`} download aria-label="Exportar PDF: informe del Panel de mantención de esta faena y período">
        <FilePdf className="mr-1 h-4 w-4 shrink-0" aria-hidden />
        Exportar PDF
      </a>
    </Button>
  )
}
