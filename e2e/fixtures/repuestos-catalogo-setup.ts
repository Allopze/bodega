import { and, asc, eq, isNotNull } from "drizzle-orm"
import * as schema from "../../db/schema"
import type { DB } from "../../db"

/**
 * Fixtures del catálogo de repuestos (fase 2) para `e2e/repuestos-catalogo.spec.ts`.
 *
 * El buscador de la solicitud pone primero lo que ya se compró para el equipo
 * elegido. Para probarlo sin depender del orden de otras specs, el sembrado deja:
 *
 * - dos repuestos que se encuentran con la misma búsqueda (`RCE2E`); el que va
 *   primero por nombre (`QA_Aceite…`) nunca se compró para el equipo;
 * - el otro (`QA_Filtro…`) con precio preferido de «Proveedor E2E» y una
 *   compra anterior (solicitud cerrada, ítem entregado) para el primer equipo
 *   de Biodiversa con ficha de mantención — el mismo que elige la spec.
 *
 * Corre después de `seedMantencionE2E`, que crea Biodiversa y sus equipos.
 */
export const REPUESTOS_CATALOGO_E2E = {
  search: "RCE2E",
  otherPart: { id: "rpt-e2e-aceite", sku: "RPT-901", name: "QA_Aceite hidráulico RCE2E" },
  vehiclePart: {
    id: "rpt-e2e-filtro", sku: "RPT-902", name: "QA_Filtro petróleo RCE2E",
    partNumber: "QA-RCE2E-1", partBrand: "Caterpillar", preferredPrice: 31990,
  },
} as const

export async function seedRepuestosCatalogoE2E(db: DB, options: { now: string }) {
  const { now } = options
  const [vehicle] = await db
    .select({ id: schema.fuelVehicles.id, worksiteId: schema.fuelVehicles.worksiteId })
    .from(schema.mantEquipmentProfiles)
    .innerJoin(schema.fuelVehicles, eq(schema.fuelVehicles.id, schema.mantEquipmentProfiles.vehicleId))
    .innerJoin(schema.worksites, eq(schema.worksites.id, schema.fuelVehicles.worksiteId))
    .where(and(
      eq(schema.worksites.name, "Biodiversa"),
      eq(schema.fuelVehicles.isActive, true),
      isNotNull(schema.fuelVehicles.code),
    ))
    .orderBy(asc(schema.fuelVehicles.code))
    .limit(1)
  if (!vehicle?.worksiteId) throw new Error("Biodiversa necesita un equipo con ficha de mantención para el catálogo de repuestos")

  const { otherPart, vehiclePart } = REPUESTOS_CATALOGO_E2E
  // `cat-repuestos` la siembra la migración del catálogo (0385).
  await db.insert(schema.products).values([
    {
      id: otherPart.id, sku: otherPart.sku, name: otherPart.name, categoryId: "cat-repuestos",
      unitOfMeasure: "unidad", isSparePart: true, partNumber: "QA-RCE2E-0", isActive: true,
      createdAt: now, updatedAt: now,
    },
    {
      id: vehiclePart.id, sku: vehiclePart.sku, name: vehiclePart.name, categoryId: "cat-repuestos",
      unitOfMeasure: "unidad", isSparePart: true, partNumber: vehiclePart.partNumber, partBrand: vehiclePart.partBrand,
      isActive: true, createdAt: now, updatedAt: now,
    },
  ])
  await db.insert(schema.productSuppliers).values({
    id: "ps-rpt-e2e-filtro", productId: vehiclePart.id, supplierId: "sup-e2e",
    unitPrice: vehiclePart.preferredPrice, isPreferred: true, lastUpdated: now,
  })

  // La compra anterior: lo que hace que el buscador lo ofrezca «Para este equipo».
  await db.insert(schema.purchaseRequests).values({
    id: "req-rpt-e2e-previa", code: "REP-2026-E2E-PREVIA", worksiteId: vehicle.worksiteId,
    requesterId: "user-admin-e2e", requestType: "repuestos", urgency: "normal", requiredDate: "2026-10-01",
    status: "closed", deliveryMode: "directo_faena", submittedAt: now, closedAt: now,
    notes: "Fixture E2E: compra previa del catálogo de repuestos", createdAt: now, updatedAt: now,
  })
  await db.insert(schema.purchaseRequestItems).values({
    id: "req-item-rpt-e2e-previa", requestId: "req-rpt-e2e-previa", productId: vehiclePart.id, productNameFree: null,
    quantity: 1, unitOfMeasure: "unidad", status: "delivered", urgency: "normal", requiredDate: "2026-10-01",
    vehicleId: vehicle.id, sortOrder: 0, createdAt: now, updatedAt: now,
  })
}
