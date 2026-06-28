import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/db"
import { fuelLoads, fuelVehicles, fuelSuppliers, worksites } from "@/db/schema"
import { inArray } from "drizzle-orm"
import { requirePermission, canAccessWorksite } from "@/lib/auth/can"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"

const CREATE_FAENA = "__create__"
const SKIP_FAENA = "__skip__"

const parsedFuelLoadSchema = z.object({
  rowIndex:         z.number().int(),
  loadDate:         z.string().min(1),
  month:            z.string().regex(/^\d{4}-\d{2}$/),
  serviceType:      z.enum(["TCT", "TAE"]),
  vehicle:          z.string().min(1),
  supplier:         z.string().min(1),
  worksite:         z.string().min(1),
  product:          z.string().min(1),
  receiptNumber:    z.string(),
  odometerReading:  z.number().nullable().optional(),
  hourMeterReading: z.number().nullable().optional(),
  liters:           z.number().min(0),
  iecFixed:         z.number().default(0),
  iecVariable:      z.number().default(0),
  baseAmount:       z.number().positive(),
  iecTotal:         z.number().default(0),
  ivaAmount:        z.number().min(0).default(0),
  totalAmount:      z.number().min(0),
})

const importBodySchema = z.object({
  loads:         z.array(parsedFuelLoadSchema),
  createMissing: z.boolean().default(false),
  faenaMapping:  z.record(z.string(), z.string()).default({}),
})

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

const loadKey = (supplierId: string, receipt: string | null, vehicleId: string, loadDate: string, liters: number) =>
  `${supplierId}::${(receipt ?? "").toUpperCase()}::${vehicleId}::${loadDate}::${liters}`

export async function POST(req: NextRequest) {
  let session
  try { session = await requirePermission("combustibles:import") }
  catch { return NextResponse.json({ ok: false, message: "Sin permisos" }, { status: 403 }) }

  let body: z.infer<typeof importBodySchema>
  try {
    const raw = await req.json()
    const parsed = importBodySchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ ok: false, message: "Payload inválido", details: parsed.error.flatten() }, { status: 400 })
    }
    body = parsed.data
  } catch {
    return NextResponse.json({ ok: false, message: "JSON inválido" }, { status: 400 })
  }

  const { loads, createMissing, faenaMapping } = body
  if (loads.length === 0) {
    return NextResponse.json({ ok: false, message: "No hay cargas para importar" }, { status: 400 })
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [allVehicles, allSuppliers, allWorksites] = await Promise.all([
        tx.query.fuelVehicles.findMany(),
        tx.query.fuelSuppliers.findMany(),
        tx.query.worksites.findMany(),
      ])

      const vehicleMap = new Map(allVehicles.map((v: { plate: string; id: string }) => [v.plate.toUpperCase(), v.id]))
      const supplierMap = new Map(allSuppliers.map((s: { name: string; id: string }) => [s.name.toUpperCase(), s.id]))
      const worksiteMap = new Map(allWorksites.map((w: { name: string; id: string }) => [w.name.toUpperCase(), w.id]))

      // Resolver el mapeo de faenas una vez: crea las faenas marcadas para crear
      // y produce fileFaena → worksiteId, o null cuando el usuario eligió omitir.
      const takenCodes = new Set(allWorksites.map((w: { code: string }) => w.code))
      const resolvedFaena = new Map<string, string | null>()
      for (const [fileFaena, target] of Object.entries(faenaMapping)) {
        if (target === SKIP_FAENA) { resolvedFaena.set(fileFaena, null); continue }
        if (target === CREATE_FAENA) {
          const id = nanoid()
          const name = toTitleCase(fileFaena)
          await tx.insert(worksites).values({ id, name, code: makeWorksiteCode(fileFaena, takenCodes), isActive: true })
          resolvedFaena.set(fileFaena, id)
          worksiteMap.set(fileFaena.toUpperCase(), id)
        } else {
          resolvedFaena.set(fileFaena, target) // worksiteId existente
        }
      }

      // Deduplicación (H3): consultar cargas existentes para los meses del archivo
      const monthsInFile = [...new Set(loads.map(l => l.month))]
      const existingLoads = monthsInFile.length > 0
        ? await tx.select({
            fuelSupplierId: fuelLoads.fuelSupplierId,
            receiptNumber: fuelLoads.receiptNumber,
            vehicleId: fuelLoads.vehicleId,
            loadDate: fuelLoads.loadDate,
            liters: fuelLoads.liters,
          }).from(fuelLoads).where(inArray(fuelLoads.month, monthsInFile))
        : []
      const seenLoads = new Set(
        existingLoads.map(l =>
          loadKey(
            l.fuelSupplierId as string,
            l.receiptNumber as string | null,
            l.vehicleId as string,
            l.loadDate as string,
            l.liters as number,
          ),
        ),
      )

      const toInsert: typeof fuelLoads.$inferInsert[] = []
      const importErrors: Array<{ rowIndex: number; field: string; message: string }> = []
      const created: Array<{ type: string; name: string }> = []

      for (const load of loads) {
        // Coherencia financiera (H2): totalAmount debe igualar base + IEC + IVA con tolerancia ±1 CLP
        const expectedTotal = load.baseAmount + load.iecTotal + load.ivaAmount
        if (Math.abs(load.totalAmount - expectedTotal) > 1) {
          importErrors.push({ rowIndex: load.rowIndex, field: "TOTAL FACTURA", message: `Total ${load.totalAmount} no cuadra con base+IEC+IVA (${expectedTotal})` })
          continue
        }

        let vehicleId = vehicleMap.get(load.vehicle.toUpperCase())
        let supplierId = supplierMap.get(load.supplier.toUpperCase())

        const mapped = resolvedFaena.has(load.worksite) ? resolvedFaena.get(load.worksite) : undefined
        if (mapped === null) {
          importErrors.push({ rowIndex: load.rowIndex, field: "FAENA", message: `"${load.worksite}" omitida` })
          continue
        }
        const worksiteId = mapped ?? worksiteMap.get(load.worksite.toUpperCase())

        // Verificación de alcance (H7): la sesión debe tener acceso a esta faena
        if (worksiteId && !canAccessWorksite(session, worksiteId)) {
          importErrors.push({ rowIndex: load.rowIndex, field: "FAENA", message: `Sin acceso a la faena "${load.worksite}"` })
          continue
        }

        // Auto-crear entidades faltantes si está habilitado
        if (!vehicleId && createMissing) {
          const id = nanoid()
          await tx.insert(fuelVehicles).values({ id, plate: load.vehicle, type: "camion", isActive: true })
          vehicleId = id
          vehicleMap.set(load.vehicle.toUpperCase(), id)
          created.push({ type: "vehículo", name: load.vehicle })
        }
        if (!supplierId && createMissing) {
          const id = nanoid()
          await tx.insert(fuelSuppliers).values({ id, name: load.supplier, isActive: true })
          supplierId = id
          supplierMap.set(load.supplier.toUpperCase(), id)
          created.push({ type: "proveedor", name: load.supplier })
        }
        // Las faenas no se auto-crean aquí (se crean vía faenaMapping)
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

        // Deduplicación (H3): omitir cargas ya presentes en la BD
        const key = loadKey(supplierId, load.receiptNumber || null, vehicleId, load.loadDate, load.liters)
        if (seenLoads.has(key)) {
          importErrors.push({ rowIndex: load.rowIndex, field: "FACTURA", message: `Carga duplicada (factura "${load.receiptNumber}", ${load.loadDate})` })
          continue
        }
        seenLoads.add(key)

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
        await tx.insert(fuelLoads).values(toInsert)
      }

      return { imported: toInsert.length, errors: importErrors, created }
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    logger.error("import API error", { error: e })
    return NextResponse.json({ ok: false, message: "Error al importar" }, { status: 500 })
  }
}
