"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { db } from "@/db"
import {
  fuelLoads,
  fuelVehicles,
  fuelSuppliers,
  fuelMonthlyStatements,
  fuelPayments,
  worksites,
} from "@/db/schema"
import { eq, and, desc, sql, ilike, gte, lte } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { nanoid } from "@/lib/id"
import {
  createFuelLoadSchema,
  updateFuelLoadSchema,
  createFuelVehicleSchema,
  updateFuelVehicleSchema,
  createFuelSupplierSchema,
  updateFuelSupplierSchema,
  createMonthlyStatementSchema,
  addPaymentSchema,
  type CreateFuelLoadInput,
  type CreateFuelVehicleInput,
  type CreateFuelSupplierInput,
} from "@/lib/combustibles/validation"
import { calculateFuelAmounts, calculateStatementTotals } from "@/lib/combustibles/calculations"
import { parseFuelExcel, type ImportError } from "@/lib/combustibles/import"
import { logger } from "@/lib/logger"
import type { ActionState } from "@/lib/validation/masters"

export type { ActionState }

const REVALIDATE = "/combustibles"

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function dbErrMsg(e: unknown, fallback: string): string {
  if (!(e instanceof Error)) return fallback
  const cause = (e as { cause?: unknown }).cause
  if (cause instanceof Error && cause.message) return cause.message
  return e.message
}

/* ═══════════════════════════════════════════════════════════════════════════
   FUEL LOADS (Cargas individuales)
   ═══════════════════════════════════════════════════════════════════════════ */

export async function createFuelLoadAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:create") }
  catch { return { ok: false, message: "Sin permisos para crear cargas" } }

  // Auto-calculate if IEC rates are configured
  const liters = Number(formData.get("liters") ?? 0)
  const baseAmount = Number(formData.get("baseAmount") ?? 0)
  const autoCalc = formData.get("autoCalc") === "true"

  let iecFixed = Number(formData.get("iecFixed") ?? 0)
  let iecVariable = Number(formData.get("iecVariable") ?? 0)
  let iecTotal = Number(formData.get("iecTotal") ?? 0)
  let ivaAmount = Number(formData.get("ivaAmount") ?? 0)
  let totalAmount = Number(formData.get("totalAmount") ?? 0)

  if (autoCalc) {
    // Try to get rates from system_settings
    const [fixedRateRow, variableRateRow] = await Promise.all([
      db.query.systemSettings.findFirst({ where: (t, { eq }) => eq(t.key, "fuel:iec_fixed_rate") }),
      db.query.systemSettings.findFirst({ where: (t, { eq }) => eq(t.key, "fuel:iec_variable_rate") }),
    ])

    const calc = calculateFuelAmounts({
      liters,
      baseAmount,
      iecFixedRate: fixedRateRow ? Number(fixedRateRow.value) : null,
      iecVariableRate: variableRateRow ? Number(variableRateRow.value) : null,
    })

    iecFixed = calc.iecFixed
    iecVariable = calc.iecVariable
    iecTotal = calc.iecTotal
    ivaAmount = calc.ivaAmount
    totalAmount = calc.totalAmount
  }

  // Derive month from loadDate
  const loadDate = String(formData.get("loadDate") ?? "")
  const month = loadDate.substring(0, 7)  // "2026-01"

  const parsed = createFuelLoadSchema.safeParse({
    loadDate,
    month,
    serviceType: formData.get("serviceType"),
    vehicleId: formData.get("vehicleId"),
    fuelSupplierId: formData.get("fuelSupplierId"),
    worksiteId: formData.get("worksiteId"),
    product: formData.get("product"),
    receiptNumber: formData.get("receiptNumber") || undefined,
    liters,
    iecFixed,
    iecVariable,
    baseAmount,
    iecTotal,
    ivaAmount,
    totalAmount,
    notes: formData.get("notes") || undefined,
  })

  if (!parsed.success) {
    return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }
  }

  try {
    const id = nanoid()
    await db.insert(fuelLoads).values({
      id,
      ...parsed.data,
      createdBy: session.user.id,
    })

    revalidatePath(REVALIDATE)
    return { ok: true, message: "Carga registrada", data: { id } }
  } catch (e) {
    logger.error("createFuelLoad error", { error: e })
    return { ok: false, message: dbErrMsg(e, "Error al registrar carga") }
  }
}

export async function updateFuelLoadAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:create") }
  catch { return { ok: false, message: "Sin permisos" } }

  const id = String(formData.get("id") ?? "")
  if (!id) return { ok: false, message: "ID requerido" }

  const existing = await db.query.fuelLoads.findFirst({ where: eq(fuelLoads.id, id) })
  if (!existing) return { ok: false, message: "Carga no encontrada" }
  if (existing.status === "reconciled") return { ok: false, message: "No se puede editar una carga conciliada" }

  const loadDate = String(formData.get("loadDate") ?? existing.loadDate)
  const month = loadDate.substring(0, 7)

  const liters = Number(formData.get("liters") ?? existing.liters)
  const baseAmount = Number(formData.get("baseAmount") ?? existing.baseAmount)

  const parsed = updateFuelLoadSchema.safeParse({
    id,
    loadDate,
    month,
    serviceType: formData.get("serviceType") ?? existing.serviceType,
    vehicleId: formData.get("vehicleId") ?? existing.vehicleId,
    fuelSupplierId: formData.get("fuelSupplierId") ?? existing.fuelSupplierId,
    worksiteId: formData.get("worksiteId") ?? existing.worksiteId,
    product: formData.get("product") ?? existing.product,
    receiptNumber: formData.get("receiptNumber") ?? existing.receiptNumber,
    liters,
    baseAmount,
    iecFixed: Number(formData.get("iecFixed") ?? existing.iecFixed),
    iecVariable: Number(formData.get("iecVariable") ?? existing.iecVariable),
    iecTotal: Number(formData.get("iecTotal") ?? existing.iecTotal),
    ivaAmount: Number(formData.get("ivaAmount") ?? existing.ivaAmount),
    totalAmount: Number(formData.get("totalAmount") ?? existing.totalAmount),
    notes: formData.get("notes") ?? existing.notes,
  })

  if (!parsed.success) {
    return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }
  }

  try {
    await db.update(fuelLoads).set({ ...parsed.data, updatedAt: new Date().toISOString() }).where(eq(fuelLoads.id, id))
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Carga actualizada" }
  } catch (e) {
    return { ok: false, message: dbErrMsg(e, "Error al actualizar") }
  }
}

export async function deleteFuelLoadAction(id: string): Promise<ActionState> {
  try { await requirePermission("combustibles:delete") }
  catch { return { ok: false, message: "Sin permisos para eliminar" } }

  try {
    await db.delete(fuelLoads).where(eq(fuelLoads.id, id))
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Carga eliminada" }
  } catch (e) {
    return { ok: false, message: dbErrMsg(e, "Error al eliminar") }
  }
}

export async function registerFuelLoadAction(id: string): Promise<ActionState> {
  try { await requirePermission("combustibles:create") }
  catch { return { ok: false, message: "Sin permisos" } }

  const existing = await db.query.fuelLoads.findFirst({ where: eq(fuelLoads.id, id) })
  if (!existing) return { ok: false, message: "Carga no encontrada" }
  if (existing.status !== "draft") return { ok: false, message: "Solo se pueden registrar cargas en borrador" }

  try {
    await db.update(fuelLoads).set({ status: "registered", updatedAt: new Date().toISOString() }).where(eq(fuelLoads.id, id))
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Carga registrada" }
  } catch (e) {
    return { ok: false, message: dbErrMsg(e, "Error al registrar") }
  }
}

/* ── Get fuel loads with filters ──────────────────────────────────────────── */

export async function getFuelLoadsAction(filters?: {
  month?: string
  serviceType?: string
  vehicleId?: string
  worksiteId?: string
  fuelSupplierId?: string
  product?: string
  status?: string
  search?: string
  page?: number
  pageSize?: number
}) {
  try { await requirePermission("combustibles:view") }
  catch { return { ok: false as const, message: "Sin permisos", data: null } }

  const page = filters?.page ?? 1
  const pageSize = filters?.pageSize ?? 50
  const offset = (page - 1) * pageSize

  const conditions = []
  if (filters?.month) conditions.push(eq(fuelLoads.month, filters.month))
  if (filters?.serviceType) conditions.push(eq(fuelLoads.serviceType, filters.serviceType))
  if (filters?.vehicleId) conditions.push(eq(fuelLoads.vehicleId, filters.vehicleId))
  if (filters?.worksiteId) conditions.push(eq(fuelLoads.worksiteId, filters.worksiteId))
  if (filters?.fuelSupplierId) conditions.push(eq(fuelLoads.fuelSupplierId, filters.fuelSupplierId))
  if (filters?.product) conditions.push(eq(fuelLoads.product, filters.product))
  if (filters?.status) conditions.push(eq(fuelLoads.status, filters.status))

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const [rows, countResult] = await Promise.all([
    db.query.fuelLoads.findMany({
      where,
      with: { vehicle: true, supplier: true, worksite: true },
      orderBy: [desc(fuelLoads.loadDate), desc(fuelLoads.createdAt)],
      limit: pageSize,
      offset,
    }),
    db.select({ count: sql<number>`count(*)` }).from(fuelLoads).where(where),
  ])

  const total = countResult[0]?.count ?? 0

  return {
    ok: true as const,
    data: {
      rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   IMPORT
   ═══════════════════════════════════════════════════════════════════════════ */

export async function importFuelLoadsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:import") }
  catch { return { ok: false, message: "Sin permisos para importar" } }

  const file = formData.get("file") as File | null
  if (!file) return { ok: false, message: "Archivo requerido" }

  try {
    const buffer = await file.arrayBuffer()
    const result = parseFuelExcel(buffer)

    if (result.errors.length > 0 && result.loads.length === 0) {
      return {
        ok: false,
        message: `${result.errors.length} errores encontrados`,
        data: { errors: result.errors, duplicates: result.duplicates },
      }
    }

    // Look up IDs for vehicles, suppliers, worksites
    const [allVehicles, allSuppliers, allWorksites] = await Promise.all([
      db.query.fuelVehicles.findMany(),
      db.query.fuelSuppliers.findMany(),
      db.query.worksites.findMany(),
    ])

    const vehicleMap = new Map(allVehicles.map(v => [v.plate.toUpperCase(), v.id]))
    const supplierMap = new Map(allSuppliers.map(s => [s.name.toUpperCase(), s.id]))
    const worksiteMap = new Map(allWorksites.map(w => [w.name.toUpperCase(), w.id]))

    const toInsert: typeof fuelLoads.$inferInsert[] = []
    const importErrors: ImportError[] = []

    for (const load of result.loads) {
      const vehicleId = vehicleMap.get(load.vehicle.toUpperCase())
      const supplierId = supplierMap.get(load.supplier.toUpperCase())
      const worksiteId = worksiteMap.get(load.worksite.toUpperCase())

      if (!vehicleId) {
        importErrors.push({ rowIndex: load.rowIndex, field: "VEHICULO", message: `Vehículo "${load.vehicle}" no encontrado` })
        continue
      }
      if (!supplierId) {
        importErrors.push({ rowIndex: load.rowIndex, field: "PROVEEDOR", message: `Proveedor "${load.supplier}" no encontrado` })
        continue
      }
      if (!worksiteId) {
        importErrors.push({ rowIndex: load.rowIndex, field: "FAENA", message: `Faena "${load.worksite}" no encontrada` })
        continue
      }

      toInsert.push({
        id: nanoid(),
        loadDate: load.loadDate,
        month: load.month,
        serviceType: load.serviceType,
        vehicleId,
        fuelSupplierId: supplierId,
        worksiteId,
        product: load.product,
        receiptNumber: load.receiptNumber || null,
        liters: load.liters,
        iecFixed: load.iecFixed,
        iecVariable: load.iecVariable,
        baseAmount: load.baseAmount,
        iecTotal: load.iecTotal,
        ivaAmount: load.ivaAmount,
        totalAmount: load.totalAmount,
        status: "registered",
        createdBy: session.user.id,
      })
    }

    if (importErrors.length > 0 && toInsert.length === 0) {
      return {
        ok: false,
        message: `${importErrors.length} errores de validación`,
        data: { errors: importErrors, duplicates: result.duplicates },
      }
    }

    // Bulk insert
    if (toInsert.length > 0) {
      await db.insert(fuelLoads).values(toInsert)
    }

    revalidatePath(REVALIDATE)
    return {
      ok: true,
      message: `${toInsert.length} cargas importadas${importErrors.length > 0 ? `, ${importErrors.length} omitidas` : ""}`,
      data: {
        imported: toInsert.length,
        errors: importErrors,
        duplicates: result.duplicates,
      },
    }
  } catch (e) {
    logger.error("importFuelLoads error", { error: e })
    return { ok: false, message: dbErrMsg(e, "Error al importar archivo") }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   FUEL VEHICLES
   ═══════════════════════════════════════════════════════════════════════════ */

export async function createFuelVehicleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try { await requirePermission("combustibles:manage_vehicles") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = createFuelVehicleSchema.safeParse({
    plate: formData.get("plate"),
    type: formData.get("type"),
    brand: formData.get("brand") || undefined,
    model: formData.get("model") || undefined,
    year: formData.get("year") || undefined,
    worksiteId: formData.get("worksiteId") || undefined,
    notes: formData.get("notes") || undefined,
  })

  if (!parsed.success) {
    return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }
  }

  try {
    const id = nanoid()
    await db.insert(fuelVehicles).values({ id, ...parsed.data })
    revalidatePath("/combustibles/vehiculos")
    return { ok: true, message: "Vehículo creado", data: { id } }
  } catch (e) {
    return { ok: false, message: dbErrMsg(e, "Error al crear vehículo") }
  }
}

export async function updateFuelVehicleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try { await requirePermission("combustibles:manage_vehicles") }
  catch { return { ok: false, message: "Sin permisos" } }

  const id = String(formData.get("id") ?? "")
  if (!id) return { ok: false, message: "ID requerido" }

  const parsed = updateFuelVehicleSchema.safeParse({
    id,
    plate: formData.get("plate") || undefined,
    type: formData.get("type") || undefined,
    brand: formData.get("brand") || undefined,
    model: formData.get("model") || undefined,
    year: formData.get("year") || undefined,
    worksiteId: formData.get("worksiteId") || undefined,
    notes: formData.get("notes") || undefined,
  })

  if (!parsed.success) {
    return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }
  }

  try {
    const { id: _, ...data } = parsed.data
    await db.update(fuelVehicles).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(fuelVehicles.id, id))
    revalidatePath("/combustibles/vehiculos")
    return { ok: true, message: "Vehículo actualizado" }
  } catch (e) {
    return { ok: false, message: dbErrMsg(e, "Error al actualizar") }
  }
}

export async function deleteFuelVehicleAction(id: string): Promise<ActionState> {
  try { await requirePermission("combustibles:manage_vehicles") }
  catch { return { ok: false, message: "Sin permisos" } }

  try {
    await db.update(fuelVehicles).set({ isActive: false, updatedAt: new Date().toISOString() }).where(eq(fuelVehicles.id, id))
    revalidatePath("/combustibles/vehiculos")
    return { ok: true, message: "Vehículo desactivado" }
  } catch (e) {
    return { ok: false, message: dbErrMsg(e, "Error al desactivar") }
  }
}

export async function getFuelVehiclesAction() {
  try { await requirePermission("combustibles:view") }
  catch { return { ok: false as const, data: [] } }

  const rows = await db.query.fuelVehicles.findMany({
    with: { worksite: true },
    orderBy: [fuelVehicles.plate],
  })
  return { ok: true as const, data: rows }
}

/* ═══════════════════════════════════════════════════════════════════════════
   FUEL SUPPLIERS
   ═══════════════════════════════════════════════════════════════════════════ */

export async function createFuelSupplierAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try { await requirePermission("combustibles:manage_suppliers") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = createFuelSupplierSchema.safeParse({
    name: formData.get("name"),
    rut: formData.get("rut") || undefined,
    contactName: formData.get("contactName") || undefined,
    contactPhone: formData.get("contactPhone") || undefined,
    contactEmail: formData.get("contactEmail") || undefined,
    notes: formData.get("notes") || undefined,
  })

  if (!parsed.success) {
    return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }
  }

  try {
    const id = nanoid()
    await db.insert(fuelSuppliers).values({ id, ...parsed.data })
    revalidatePath("/combustibles/proveedores-combustible")
    return { ok: true, message: "Proveedor creado", data: { id } }
  } catch (e) {
    return { ok: false, message: dbErrMsg(e, "Error al crear proveedor") }
  }
}

export async function updateFuelSupplierAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try { await requirePermission("combustibles:manage_suppliers") }
  catch { return { ok: false, message: "Sin permisos" } }

  const id = String(formData.get("id") ?? "")
  if (!id) return { ok: false, message: "ID requerido" }

  const parsed = updateFuelSupplierSchema.safeParse({
    id,
    name: formData.get("name") || undefined,
    rut: formData.get("rut") || undefined,
    contactName: formData.get("contactName") || undefined,
    contactPhone: formData.get("contactPhone") || undefined,
    contactEmail: formData.get("contactEmail") || undefined,
    notes: formData.get("notes") || undefined,
  })

  if (!parsed.success) {
    return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }
  }

  try {
    const { id: _, ...data } = parsed.data
    await db.update(fuelSuppliers).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(fuelSuppliers.id, id))
    revalidatePath("/combustibles/proveedores-combustible")
    return { ok: true, message: "Proveedor actualizado" }
  } catch (e) {
    return { ok: false, message: dbErrMsg(e, "Error al actualizar") }
  }
}

export async function getFuelSuppliersAction() {
  try { await requirePermission("combustibles:view") }
  catch { return { ok: false as const, data: [] } }

  const rows = await db.query.fuelSuppliers.findMany({
    orderBy: [fuelSuppliers.name],
  })
  return { ok: true as const, data: rows }
}

/* ═══════════════════════════════════════════════════════════════════════════
   MONTHLY STATEMENTS (Cuenta corriente mensual)
   ═══════════════════════════════════════════════════════════════════════════ */

export async function createMonthlyStatementAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:create") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = createMonthlyStatementSchema.safeParse({
    month: formData.get("month"),
    fuelSupplierId: formData.get("fuelSupplierId"),
    dueDate: formData.get("dueDate") || undefined,
    notes: formData.get("notes") || undefined,
  })

  if (!parsed.success) {
    return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }
  }

  try {
    // Check if statement already exists for this month + supplier
    const existing = await db.query.fuelMonthlyStatements.findFirst({
      where: and(
        eq(fuelMonthlyStatements.month, parsed.data.month),
        eq(fuelMonthlyStatements.fuelSupplierId, parsed.data.fuelSupplierId),
      ),
    })
    if (existing) return { ok: false, message: "Ya existe un resumen para este mes y proveedor" }

    // Get all unassigned loads for this month + supplier
    const loads = await db.query.fuelLoads.findMany({
      where: and(
        eq(fuelLoads.month, parsed.data.month),
        eq(fuelLoads.fuelSupplierId, parsed.data.fuelSupplierId),
        sql`${fuelLoads.statementId} IS NULL`,
      ),
    })

    if (loads.length === 0) return { ok: false, message: "No hay cargas sin asignar para este mes y proveedor" }

    const totals = calculateStatementTotals(loads)

    const id = nanoid()
    await db.insert(fuelMonthlyStatements).values({
      id,
      ...parsed.data,
      ...totals,
      createdBy: session.user.id,
    })

    // Assign loads to statement
    await db.update(fuelLoads)
      .set({ statementId: id, updatedAt: new Date().toISOString() })
      .where(and(
        eq(fuelLoads.month, parsed.data.month),
        eq(fuelLoads.fuelSupplierId, parsed.data.fuelSupplierId),
        sql`${fuelLoads.statementId} IS NULL`,
      ))

    revalidatePath("/combustibles/cuenta-corriente")
    return { ok: true, message: `Resumen creado con ${loads.length} cargas`, data: { id } }
  } catch (e) {
    return { ok: false, message: dbErrMsg(e, "Error al crear resumen") }
  }
}

export async function getMonthlyStatementsAction(filters?: { month?: string; status?: string }) {
  try { await requirePermission("combustibles:view") }
  catch { return { ok: false as const, data: [] } }

  const conditions = []
  if (filters?.month) conditions.push(eq(fuelMonthlyStatements.month, filters.month))
  if (filters?.status) conditions.push(eq(fuelMonthlyStatements.status, filters.status))
  const where = conditions.length > 0 ? and(...conditions) : undefined

  const rows = await db.query.fuelMonthlyStatements.findMany({
    where,
    with: { supplier: true, payments: true },
    orderBy: [desc(fuelMonthlyStatements.month)],
  })

  return { ok: true as const, data: rows }
}

export async function getMonthlyStatementByIdAction(id: string) {
  try { await requirePermission("combustibles:view") }
  catch { return { ok: false as const, data: null } }

  const row = await db.query.fuelMonthlyStatements.findFirst({
    where: eq(fuelMonthlyStatements.id, id),
    with: {
      supplier: true,
      payments: true,
      loads: { with: { vehicle: true, worksite: true } },
    },
  })

  return { ok: true as const, data: row ?? null }
}

/* ═══════════════════════════════════════════════════════════════════════════
   PAYMENTS
   ═══════════════════════════════════════════════════════════════════════════ */

export async function addPaymentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try { await requirePermission("combustibles:create") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = addPaymentSchema.safeParse({
    statementId: formData.get("statementId"),
    paymentDate: formData.get("paymentDate"),
    amount: formData.get("amount"),
    paymentMethod: formData.get("paymentMethod") || undefined,
    reference: formData.get("reference") || undefined,
    notes: formData.get("notes") || undefined,
  })

  if (!parsed.success) {
    return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }
  }

  try {
    const statement = await db.query.fuelMonthlyStatements.findFirst({
      where: eq(fuelMonthlyStatements.id, parsed.data.statementId),
    })
    if (!statement) return { ok: false, message: "Resumen no encontrado" }
    if (statement.status === "paid" || statement.status === "cancelled") {
      return { ok: false, message: "No se pueden agregar pagos a este resumen" }
    }

    const paymentId = nanoid()
    await db.insert(fuelPayments).values({
      id: paymentId,
      ...parsed.data,
      createdBy: (await requirePermission("combustibles:create")).user.id,
    })

    // Update statement paid amount and status
    const newPaidAmount = (statement.paidAmount ?? 0) + parsed.data.amount
    const newStatus = newPaidAmount >= (statement.totalAmount ?? 0) ? "paid" : "partial"

    await db.update(fuelMonthlyStatements).set({
      paidAmount: newPaidAmount,
      status: newStatus,
      updatedAt: new Date().toISOString(),
    }).where(eq(fuelMonthlyStatements.id, parsed.data.statementId))

    revalidatePath("/combustibles/cuenta-corriente")
    return { ok: true, message: "Pago registrado" }
  } catch (e) {
    return { ok: false, message: dbErrMsg(e, "Error al registrar pago") }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   REPORTS
   ═══════════════════════════════════════════════════════════════════════════ */

export async function getFuelReportAction(filters: {
  startDate?: string
  endDate?: string
  groupBy: "month" | "worksite" | "vehicle" | "supplier" | "product"
}) {
  try { await requirePermission("combustibles:view") }
  catch { return { ok: false as const, data: null } }

  const conditions = []
  if (filters.startDate) conditions.push(gte(fuelLoads.loadDate, filters.startDate))
  if (filters.endDate) conditions.push(lte(fuelLoads.loadDate, filters.endDate))
  const where = conditions.length > 0 ? and(...conditions) : undefined

  // Group by query
  let groupColumn
  switch (filters.groupBy) {
    case "month": groupColumn = fuelLoads.month; break
    case "worksite": groupColumn = fuelLoads.worksiteId; break
    case "vehicle": groupColumn = fuelLoads.vehicleId; break
    case "supplier": groupColumn = fuelLoads.fuelSupplierId; break
    case "product": groupColumn = fuelLoads.product; break
  }

  const rows = await db.select({
    group: groupColumn,
    totalLiters: sql<number>`sum(${fuelLoads.liters})`,
    totalBaseAmount: sql<number>`sum(${fuelLoads.baseAmount})`,
    totalIec: sql<number>`sum(${fuelLoads.iecTotal})`,
    totalIva: sql<number>`sum(${fuelLoads.ivaAmount})`,
    totalAmount: sql<number>`sum(${fuelLoads.totalAmount})`,
    count: sql<number>`count(*)`,
  })
    .from(fuelLoads)
    .where(where)
    .groupBy(groupColumn)
    .orderBy(desc(sql`sum(${fuelLoads.totalAmount})`))

  return { ok: true as const, data: rows }
}
