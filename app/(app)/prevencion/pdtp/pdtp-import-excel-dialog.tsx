"use client"

/**
 * Botón visible + Dialog que expone la importación de un programa PDTP desde
 * Excel directamente desde la página de detalle del programa.
 *
 * Antes este flujo solo existía escondido tras 3 clics: Editar → pestaña
 * "Revisión" → desplegar "Vistas avanzadas y migración desde Excel". El
 * usuario real no lo encontraba. Ahora vive en el `PageHeader.actions` de la
 * página principal del programa (visible solo si el programa es un borrador
 * editable y el usuario tiene `prevention:pdtp:program:manage`).
 *
 * La lógica stage→preview→apply/cancel es la misma del editor: delega en
 * `<ImportExcelSection>` para no duplicar las ~230 líneas que hablan con
 * `/api/prevencion/pdtp/import`.
 */

import * as React from "react"
import { UploadSimple } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ImportExcelSection } from "./[programId]/editar/import-excel-section"

export type PdtpImportExcelDialogProps = {
  programId: string
  visibleWorksites: Array<{ id: string; name: string; code: string }>
  /** Todas las faenas activas del sistema (para el selector de importación). */
  allWorksites: Array<{ id: string; name: string; code: string }>
  /** Tamaño del botón disparador; por defecto "sm" para encajar en el header. */
  size?: "sm" | "default" | "lg" | "icon"
}

export function PdtpImportExcelDialog({
  programId,
  visibleWorksites,
  allWorksites,
  size = "sm",
}: PdtpImportExcelDialogProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size={size} className="gap-1.5">
          <UploadSimple size={16} weight="bold" />
          Importar Excel
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Importar programa desde Excel</DialogTitle>
          <DialogDescription>
            Carga un archivo <code className="rounded bg-[var(--color-surface-2)] px-1 py-0.5 text-[11px]">.xlsx</code> con la estructura del Programa de Trabajo Preventivo SG-SST
            (hojas <em>PDTP GENERAL</em>, <em>CPHS</em>, <em>PRF y Adm. de contrato</em>, etc.). El programa no se modifica hasta que confirmes el preview.
          </DialogDescription>
        </DialogHeader>
        <ImportExcelSection programId={programId} visibleWorksites={visibleWorksites} allWorksites={allWorksites} />
      </DialogContent>
    </Dialog>
  )
}
