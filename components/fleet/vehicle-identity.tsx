import Link from "next/link"
import { cn } from "@/lib/utils"

/**
 * Cómo se nombra un vehículo en cualquier tabla del área Control operacional.
 *
 * Antes el mismo camión aparecía de cinco maneras: Flota mostraba la patente sin
 * código, el Panel el código en mono con «Camión · patente», Cargas el código en
 * verde, Pagos «KA-115 · DZTH-66» en mono negrita y Por revisar «KA-127 · KLJZ-69»
 * en sans (auditoría 2026-11-13, T3). Una fila no se podía cruzar con un aviso que
 * listaba códigos. Este componente fija el orden: el código interno es el nombre
 * (mono, porque se lee como identificador) y la patente va debajo, junto al tipo.
 *
 * Sin código interno, la patente toma su lugar y no se repite abajo.
 */
export interface VehicleIdentityProps {
  /** Código interno del equipo (`KA-115`). */
  code?: string | null
  /** Patente (`DZTH-66`). */
  plate?: string | null
  /** Tipo legible (`Camión`, `Excavadora`). */
  type?: string | null
  /** Ficha del vehículo: si viene, el código es un enlace real. */
  href?: string | null
  /** Texto accesible del enlace; por defecto «Ver ficha de KA-115». */
  linkLabel?: string
  className?: string
}

export function vehicleIdentityParts({ code, plate, type }: Pick<VehicleIdentityProps, "code" | "plate" | "type">): { primary: string; secondary: string | null } {
  const cleanCode = code?.trim() || null
  const cleanPlate = plate?.trim() || null
  const cleanType = type?.trim() || null
  const primary = cleanCode ?? cleanPlate ?? "Sin identificar"
  const secondaryParts = [cleanType, cleanCode && cleanPlate && cleanPlate !== cleanCode ? cleanPlate : null].filter(Boolean)
  return { primary, secondary: secondaryParts.length > 0 ? secondaryParts.join(" · ") : null }
}

export function VehicleIdentity({ code, plate, type, href, linkLabel, className }: VehicleIdentityProps) {
  const { primary, secondary } = vehicleIdentityParts({ code, plate, type })
  const primaryClass = "font-mono text-sm font-medium tabular-nums whitespace-nowrap"
  return (
    <span className={cn("inline-flex min-w-0 flex-col", className)}>
      {href ? (
        <Link
          href={href}
          aria-label={linkLabel ?? `Ver ficha de ${primary}`}
          className={cn(primaryClass, "text-[var(--color-primary-ink)] underline-offset-2 hover:underline focus-visible:underline")}
        >
          {primary}
        </Link>
      ) : (
        <span className={cn(primaryClass, "text-[var(--color-text)]")}>{primary}</span>
      )}
      {secondary && <span className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">{secondary}</span>}
    </span>
  )
}
