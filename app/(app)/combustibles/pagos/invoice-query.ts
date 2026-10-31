import type { Session } from "next-auth"
import { and, inArray, or, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { fuelLoads, fuelSuppliers, fuelVehicles } from "@/db/schema"
import { textSearchSql } from "@/lib/adquisiciones/list-query"
import { buildFuelLoadsWhere, type FuelLoadFilters } from "@/lib/combustibles/queries"

export interface InvoiceFilters extends FuelLoadFilters {
  /** Texto libre: N.º de factura, patente o código del equipo, o proveedor. */
  q?: string
}

/**
 * El WHERE de «Pagos › Facturas» y de su exportación a Excel: los filtros de
 * siempre (con el alcance por faena de la sesión, en `buildFuelLoadsWhere`) más
 * la búsqueda. La búsqueda va con subconsultas y no con joins para que las mismas
 * condiciones sirvan a la lista, al conteo, a los totales y a los gráficos sin
 * tocar sus `FROM`.
 */
export function buildInvoiceWhere(session: Session, filters: InvoiceFilters = {}): SQL | undefined {
  const { q, ...rest } = filters
  const base = buildFuelLoadsWhere(session, rest)
  const text = q?.trim()
  if (!text) return base

  // La patente se escribe con o sin guiones («AB-CD-12», «abcd12»).
  const compact = text.replace(/[^A-Za-z0-9]/g, "").toUpperCase()
  const plateCompact = compact.length >= 3
    ? sql`regexp_replace(upper(${fuelVehicles.plate}), '[^A-Z0-9]', '', 'g') like ${`%${compact}%`}`
    : undefined

  const search = or(
    textSearchSql(text, [fuelLoads.receiptNumber]),
    inArray(
      fuelLoads.vehicleId,
      db.select({ id: fuelVehicles.id }).from(fuelVehicles).where(or(textSearchSql(text, [fuelVehicles.plate, fuelVehicles.code]), plateCompact)),
    ),
    inArray(
      fuelLoads.fuelSupplierId,
      db.select({ id: fuelSuppliers.id }).from(fuelSuppliers).where(textSearchSql(text, [fuelSuppliers.name])),
    ),
  ) as SQL
  return base ? (and(base, search) as SQL) : search
}
