import type { DB, Tx } from "@/db"
import { costCenters, fuelVehicles, mantPartsNotes, products, suppliers, users, worksiteAliases, worksites } from "@/db/schema"
import { eq, inArray } from "drizzle-orm"
import type { ExistingNote } from "./types"

/**
 * Los maestros contra los que se calza el archivo. Se leen una sola vez al inicio (simulación y aplicación leen lo mismo):
 * las notas se resuelven en memoria con `buildResolvers` y la base sólo se vuelve a tocar para escribir.
 */
export interface Catalogs {
  worksites: Array<{ id: string; name: string }>
  aliases: Array<{ worksiteId: string; aliasKey: string }>
  users: Array<{ id: string; name: string; email: string; isActive: boolean }>
  /** Con su faena y si están activos: un cargo sólo calza con un equipo activo de la faena de la nota (ver `resolvers.charge`). */
  vehicles: Array<{ id: string; code: string | null; plate: string; worksiteId: string; isActive: boolean }>
  /** Sólo repuestos (`is_spare_part`). */
  products: Array<{ id: string; sku: string; name: string; partNumber: string | null; unitOfMeasure: string; isActive: boolean }>
  suppliers: Array<{ id: string; name: string; rut: string | null; isActive: boolean }>
  costCenters: Array<{ id: string; name: string; worksiteId: string | null; isActive: boolean }>
}

type Client = DB | Tx

export async function loadCatalogs(client: Client): Promise<Catalogs> {
  const [sites, aliases, people, vehicles, parts, vendors, centers] = await Promise.all([
    client.select({ id: worksites.id, name: worksites.name }).from(worksites),
    client.select({ worksiteId: worksiteAliases.worksiteId, aliasKey: worksiteAliases.aliasKey }).from(worksiteAliases),
    client.select({ id: users.id, name: users.name, email: users.email, isActive: users.isActive }).from(users),
    client.select({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate, worksiteId: fuelVehicles.worksiteId, isActive: fuelVehicles.isActive }).from(fuelVehicles),
    client.select({ id: products.id, sku: products.sku, name: products.name, partNumber: products.partNumber, unitOfMeasure: products.unitOfMeasure, isActive: products.isActive })
      .from(products).where(eq(products.isSparePart, true)),
    client.select({ id: suppliers.id, name: suppliers.name, rut: suppliers.rut, isActive: suppliers.isActive }).from(suppliers),
    client.select({ id: costCenters.id, name: costCenters.name, worksiteId: costCenters.worksiteId, isActive: costCenters.isActive }).from(costCenters),
  ])
  return { worksites: sites, aliases, users: people, vehicles, products: parts, suppliers: vendors, costCenters: centers }
}

/** Las notas de la lista que ya existen (por `external_ref`), con su folio y su estado actual. */
export async function loadExistingNotes(client: Client, externalRefs: readonly string[]): Promise<Map<string, ExistingNote>> {
  const found = new Map<string, ExistingNote>()
  for (let start = 0; start < externalRefs.length; start += 500) {
    const rows = await client
      .select({ externalRef: mantPartsNotes.externalRef, code: mantPartsNotes.code, status: mantPartsNotes.status })
      .from(mantPartsNotes)
      .where(inArray(mantPartsNotes.externalRef, externalRefs.slice(start, start + 500)))
    for (const row of rows) if (row.externalRef) found.set(row.externalRef, { externalRef: row.externalRef, code: row.code, status: row.status })
  }
  return found
}
