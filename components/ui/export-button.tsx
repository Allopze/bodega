"use client"

import * as React from "react"
import { Button, type ButtonProps } from "@/components/ui/button"
import { FileXls } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"

/**
 * Ícono único de «Exportar Excel» en toda la app. Había dos (una flecha de
 * descarga en Solicitudes, Compras y Facturas; el archivo «XLS» en Flota,
 * Control operacional y Mantención): auditoría UX-08, 2026-11-07. Quien arme un
 * disparador propio (menú, diálogo) usa éste.
 */
export const EXPORT_ICON = FileXls

export interface ExportActionResult {
  ok: boolean
  data?: {
    base64: string
    filename: string
    truncated?: boolean
    rowLimit?: number
  }
  message?: string
}

/**
 * `TFilters` ata la acción a los filtros que se le pasan. Antes ambos eran
 * `unknown`, lo que no compilaba: una acción que espera un tipo concreto no es
 * asignable a una que acepta `unknown` (los parámetros son contravariantes).
 * Se omite `filters` cuando la acción ya viene cerrada sobre sus argumentos.
 */
export interface ExportButtonProps<TFilters = undefined> {
  action: (filters: TFilters) => Promise<ExportActionResult>
  filters?: TFilters
  label?: string
  /** Nombre accesible completo cuando el rótulo visible es corto (debe contener el rótulo: WCAG 2.5.3). */
  ariaLabel?: string
  variant?: ButtonProps["variant"]
  size?: ButtonProps["size"]
  className?: string
}

export function downloadBase64Xlsx(base64: string, filename: string) {
  const link = document.createElement("a")
  link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}`
  link.download = filename
  link.click()
}

/**
 * Descarga de un Excel desde una acción de servidor: `loading` mientras exporta y un aviso al
 * terminar. Lo usan `ExportButton` y los menús «Exportar» que no son un botón directo.
 */
export function useXlsxExport<TFilters = undefined>(
  action: (filters: TFilters) => Promise<ExportActionResult>,
  filters?: TFilters,
) {
  const [loading, setLoading] = React.useState(false)

  const run = React.useCallback(async () => {
    setLoading(true)
    try {
      const result = await action(filters as TFilters)
      if (result.ok && result.data) {
        downloadBase64Xlsx(result.data.base64, result.data.filename)
        if (result.data.truncated) {
          const limitStr = result.data.rowLimit ? result.data.rowLimit.toLocaleString("es-CL") : ""
          toast.warning(`Archivo exportado con límite de ${limitStr} filas`)
        } else {
          toast.success("Archivo exportado")
        }
      } else {
        toast.error(result.message ?? "Error al exportar")
      }
    } catch {
      toast.error("Error al exportar")
    } finally {
      setLoading(false)
    }
  }, [action, filters])

  return { run, loading }
}

export interface ExportLinkProps {
  href: string
  label?: string
  /** Nombre accesible completo cuando el rótulo visible es corto (debe contener el rótulo: WCAG 2.5.3). */
  ariaLabel?: string
  variant?: ButtonProps["variant"]
  size?: ButtonProps["size"]
  className?: string
  /** `true` (default) descarga con el nombre que da el servidor; un `string` fija el nombre del archivo. */
  download?: boolean | string
}

/**
 * Exportar Excel por GET (`/api/reportes/export?...`, `/api/.../xlsx`): el mismo
 * botón que `ExportButton` —rótulo, ícono y jerarquía `secondary`— pero como
 * enlace, porque la descarga la resuelve el navegador contra una ruta y no una
 * acción de servidor. Sigue siendo `role=link`.
 */
export function ExportLink({
  href,
  label = "Exportar Excel",
  ariaLabel,
  variant = "secondary",
  size = "sm",
  className,
  download = true,
}: ExportLinkProps) {
  return (
    <Button variant={variant} size={size} className={className} asChild>
      <a href={href} download={download || undefined} aria-label={ariaLabel}>
        <EXPORT_ICON className="h-4 w-4 mr-1 shrink-0" />
        {label}
      </a>
    </Button>
  )
}

export function ExportButton<TFilters = undefined>({
  action,
  filters,
  label = "Exportar Excel",
  ariaLabel,
  variant = "secondary",
  size = "sm",
  className,
}: ExportButtonProps<TFilters>) {
  const { run, loading } = useXlsxExport(action, filters)

  return (
    <Button
      variant={variant}
      size={size}
      onClick={run}
      loading={loading}
      className={className}
      aria-label={ariaLabel}
    >
      <EXPORT_ICON className="h-4 w-4 mr-1 shrink-0" />
      {label}
    </Button>
  )
}
