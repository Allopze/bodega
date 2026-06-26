import { NextRequest, NextResponse } from "next/server"
import { db } from "@/db"
import { fuelLoads, fuelVehicles, fuelSuppliers, worksites } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import type { ParsedFuelLoad } from "@/lib/combustibles/import"

const CREATE_FAENA = "__create__"
const SKIP_FAENA = "__skip__"

// Conectores que se mantienen en minúscula en title-case (salvo al inicio).
const TITLE_LOWER = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "a"])

/** "FAENA BIODIVERSA" → "Faena Biodiversa"; "FLOR DEL LAJA" → "Flor del Laja". */
function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/\p{L}+/gu, (word, idx: number) =>
    idx > 0 && TITLE_LOWER.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
  )
}

/** Genera un código de faena único (esquema "FN-XXXX") a partir del nombre. */
function makeWorksiteCode(name: string, taken: Set<string>): string {
  const slug = name.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 8) || "FAENA"
  let code = `FN-${slug}`
  let i = 1
  while (taken.has(code)) code = `FN-${slug}-${i++}`
  taken.add(code)
  return code
}

export async function POST(req: NextRequest) {
  let session
  try { session = await requirePermission("combustibles:import") }
  catch { return NextResponse.json({ ok: false, message: "Sin permisos" }, { status: 403 }) }

  try {
    const body = await req.json()
    const loads: ParsedFuelLoad[] = body.loads
    const createMissing: boolean = body.createMissing ?? false
    // Mapeo faena-del-Excel → worksiteId | CREATE_FAENA | SKIP_FAENA
    const faenaMapping: Record<string, string> = body.faenaMapping ?? {}
    if (!Array.isArray(loads) || loads.length === 0) {
      return NextResponse.json({ ok: false, message: "No hay cargas para importar" }, { status: 400 })
    }

    const [allVehicles, allSuppliers, allWorksites] = await Promise.all([
      db.query.fuelVehicles.findMany(),
      db.query.fuelSuppliers.findMany(),
      db.query.worksites.findMany(),
    ])

    const vehicleMap = new Map(allVehicles.map(v => [v.plate.toUpperCase(), v.id]))
    const supplierMap = new Map(allSuppliers.map(s => [s.name.toUpperCase(), s.id]))
    const worksiteMap = new Map(allWorksites.map(w => [w.name.toUpperCase(), w.id]))

    const toInsert: typeof fuelLoads.$inferInsert[] = []
    const importErrors: Array<{ rowIndex: number; field: string; message: string }> = []
    const created: Array<{ type: string; name: string }> = []

    // Resolver el mapeo de faenas una vez: crea las faenas marcadas para crear
    // y produce fileFaena → worksiteId, o null cuando el usuario eligió omitir.
    const takenCodes = new Set(allWorksites.map(w => w.code))
    const resolvedFaena = new Map<string, string | null>()
    for (const [fileFaena, target] of Object.entries(faenaMapping)) {
      if (target === SKIP_FAENA) { resolvedFaena.set(fileFaena, null); continue }
      if (target === CREATE_FAENA) {
        const id = nanoid()
        const name = toTitleCase(fileFaena)
        await db.insert(worksites).values({ id, name, code: makeWorksiteCode(fileFaena, takenCodes), isActive: true })
        resolvedFaena.set(fileFaena, id)
        worksiteMap.set(fileFaena.toUpperCase(), id)
        created.push({ type: "faena", name })
      } else {
        resolvedFaena.set(fileFaena, target)  // worksiteId existente
      }
    }

    for (const load of loads) {
      let vehicleId = vehicleMap.get(load.vehicle.toUpperCase())
      let supplierId = supplierMap.get(load.supplier.toUpperCase())
      // Faena: primero el mapeo explícito del usuario (incl. "omitir" = null),
      // si no, match por nombre como respaldo.
      const mapped = resolvedFaena.has(load.worksite) ? resolvedFaena.get(load.worksite) : undefined
      if (mapped === null) {
        importErrors.push({ rowIndex: load.rowIndex, field: "FAENA", message: `"${load.worksite}" omitida` })
        continue
      }
      const worksiteId = mapped ?? worksiteMap.get(load.worksite.toUpperCase())

      // Auto-create missing entities if enabled
      if (!vehicleId && createMissing) {
        const id = nanoid()
        await db.insert(fuelVehicles).values({ id, plate: load.vehicle, type: "camion", isActive: true })
        vehicleId = id
        vehicleMap.set(load.vehicle.toUpperCase(), id)
        created.push({ type: "vehículo", name: load.vehicle })
      }
      if (!supplierId && createMissing) {
        const id = nanoid()
        await db.insert(fuelSuppliers).values({ id, name: load.supplier, isActive: true })
        supplierId = id
        supplierMap.set(load.supplier.toUpperCase(), id)
        created.push({ type: "proveedor", name: load.supplier })
      }
      // Worksites should NOT be auto-created (they are a shared catalog)
      if (!worksiteId) {
        importErrors.push({ rowIndex: load.rowIndex, field: "FAENA", message: `"${load.worksite}" no encontrada` })
        continue
      }
      if (!vehicleId) {
        importErrors.push({ rowIndex: load.rowIndex, field: "VEHICULO", message: `"${load.vehicle}" no encontrado` })
        continue
      }
      if (!supplierId) {
        importErrors.push({ rowIndex: load.rowIndex, field: "PROVEEDOR", message: `"${load.supplier}" no encontrado` })
        continue
      }

      toInsert.push({
        id: nanoid(),
        loadDate: load.loadDate, month: load.month, serviceType: load.serviceType,
        vehicleId, fuelSupplierId: supplierId, worksiteId,
        product: load.product, receiptNumber: load.receiptNumber || null,
        odometerReading: load.odometerReading ?? null,
        hourMeterReading: load.hourMeterReading ?? null,
        liters: load.liters, iecFixed: load.iecFixed, iecVariable: load.iecVariable,
        baseAmount: load.baseAmount, iecTotal: load.iecTotal, ivaAmount: load.ivaAmount,
        totalAmount: load.totalAmount, status: "registered", createdBy: session.user.id,
      })
    }

    if (toInsert.length > 0) {
      await db.insert(fuelLoads).values(toInsert)
    }

    return NextResponse.json({ ok: true, imported: toInsert.length, errors: importErrors, created })
  } catch (e) {
    logger.error("import API error", { error: e })
    return NextResponse.json({ ok: false, message: "Error al importar" }, { status: 500 })
  }
}
