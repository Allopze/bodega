"use client"

import * as React from "react"
import { DownloadSimple } from "@phosphor-icons/react"
import { ExportDialog, type StatusOption } from "@/components/export-dialog"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { WorksiteOption } from "@/components/ui/worksite-select"

interface ReportExportDefinition {
  tipo: string
  label: string
  statuses?: StatusOption[]
  tone?: "neutral" | "signal"
  /** Los reportes que son una foto de hoy no ofrecen rango de fechas. */
  showDateRange?: boolean
}

const REPORT_EXPORTS: ReportExportDefinition[] = [
  {
    tipo: "items_sin_oc",
    label: "Ítems sin OC",
    tone: "signal",
    statuses: [
      { value: "approved", label: "Aprobado" },
      { value: "pending_purchase", label: "Pendiente compra" },
    ],
  },
  {
    tipo: "gasto_faena",
    label: "Gasto por faena",
    statuses: [
      { value: "draft", label: "Borrador" },
      { value: "sent", label: "Enviada" },
      { value: "received", label: "Recibida" },
      { value: "cancelled", label: "Cancelada" },
    ],
  },
  { tipo: "oc_cerradas_sin_factura", label: "OC cerradas sin factura" },
  { tipo: "dte_libro_compras", label: "Libro de Compras DTE" },
  { tipo: "dte_conciliacion", label: "Conciliación OC-Factura-DTE" },
  { tipo: "dte_facturas_sin_oc", label: "Facturas DTE sin OC", tone: "signal" },
  { tipo: "facturacion_cobranza", label: "Facturación y cobranza" },
  // Bodega: valorización es una foto de hoy (sin rango), rotación sí acota el
  // período de consumo.
  { tipo: "bodega_valorizacion", label: "Valorización de inventario", showDateRange: false },
  { tipo: "bodega_rotacion", label: "Rotación y stock muerto" },
  {
    tipo: "oc_por_estado",
    label: "OC por estado",
    statuses: [
      { value: "draft", label: "Borrador" },
      { value: "sent", label: "Enviada" },
      { value: "office_received", label: "Recibida oficina" },
      { value: "received", label: "Recibida" },
      { value: "cancelled", label: "Cancelada" },
    ],
  },
]

export function ReportsExportMenu({ worksites }: { worksites: WorksiteOption[] }) {
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [openTipo, setOpenTipo] = React.useState<string | null>(null)

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button size="sm">
            <DownloadSimple size={14} />Exportar Excel
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Elige el informe a exportar</DropdownMenuLabel>
          {REPORT_EXPORTS.map((report) => (
            <DropdownMenuItem key={report.tipo} onSelect={() => setOpenTipo(report.tipo)}>
              {report.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Los diálogos viven fuera del menú a propósito. Montados dentro de
          `DropdownMenuContent`, cerrar el menú desmonta su contenido y se lleva
          el diálogo con él: el enlace "Descargar" desaparecía bajo el cursor y
          la exportación no llegaba a iniciarse. */}
      {REPORT_EXPORTS.map((report) => (
        <ExportDialog
          key={report.tipo}
          tipo={report.tipo}
          label={report.label}
          worksites={worksites}
          statuses={report.statuses}
          tone={report.tone}
          showDateRange={report.showDateRange ?? true}
          open={openTipo === report.tipo}
          onOpenChange={(open) => setOpenTipo(open ? report.tipo : null)}
        />
      ))}
    </>
  )
}
