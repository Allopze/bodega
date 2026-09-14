"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { suppliers } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import { logger } from "@/lib/logger"
import { parseCatalogWorkbook } from "@/lib/services/catalog-import"
import { supplierSchema, type ActionState } from "@/lib/validation/masters"
import { assertIdentityStable, MasterIdentityError } from "@/lib/services/master-identity"
import { describeSupplierDependencies, getSupplierDependencies, supplierHasDocuments } from "@/lib/services/supplier-deactivation"

const REVALIDATE = "/admin/proveedores"

export async function createSupplier(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:suppliers") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = supplierSchema.safeParse({
    name:         formData.get("name"),
    rut:          formData.get("rut") || undefined,
    businessActivity: formData.get("businessActivity") || undefined,
    contactName:  formData.get("contactName") || undefined,
    email:        formData.get("email") || undefined,
    phone:        formData.get("phone") || undefined,
    address:      formData.get("address") || undefined,
    commune:      formData.get("commune") || undefined,
    city:         formData.get("city") || undefined,
    paymentTerms: formData.get("paymentTerms") || undefined,
    notes:        formData.get("notes") || undefined,
    isActive:     formData.get("isActive") === "on",
  })
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  const d = parsed.data

  if (d.rut) {
    const rutConflict = await db.query.suppliers.findFirst({ where: eq(suppliers.rut, d.rut) })
    if (rutConflict) return { ok: false, fieldErrors: { rut: ["Este RUT ya está registrado"] } }
  }

  const id = nanoid()
  await db.insert(suppliers).values({
    id, name: d.name, rut: d.rut ?? null,
    businessActivity: d.businessActivity ?? null,
    contactName:  d.contactName  ?? null,
    email:        d.email        ?? null,
    phone:        d.phone        ?? null,
    address:      d.address      ?? null,
    commune:      d.commune      ?? null,
    city:         d.city         ?? null,
    paymentTerms: d.paymentTerms ?? null,
    notes:        d.notes        ?? null,
    isActive:     d.isActive,
  })

  await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "create", entityType: "supplier", entityId: id, newState: { name: d.name, rut: d.rut } })

  revalidatePath(REVALIDATE)
  return { ok: true, message: `Proveedor ${d.name} creado` }
}

export async function updateSupplier(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:suppliers") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = supplierSchema.safeParse({
    id:           formData.get("id"),
    name:         formData.get("name"),
    rut:          formData.get("rut") || undefined,
    businessActivity: formData.get("businessActivity") || undefined,
    contactName:  formData.get("contactName") || undefined,
    email:        formData.get("email") || undefined,
    phone:        formData.get("phone") || undefined,
    address:      formData.get("address") || undefined,
    commune:      formData.get("commune") || undefined,
    city:         formData.get("city") || undefined,
    paymentTerms: formData.get("paymentTerms") || undefined,
    notes:        formData.get("notes") || undefined,
    isActive:     formData.get("isActive") === "on",
  })
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  const d = parsed.data
  if (!d.id) return { ok: false, message: "ID requerido" }

  if (d.rut) {
    const conflict = await db.query.suppliers.findFirst({ where: eq(suppliers.rut, d.rut) })
    if (conflict && conflict.id !== d.id) return { ok: false, fieldErrors: { rut: ["Este RUT ya está registrado"] } }
  }

  const current = await db.query.suppliers.findFirst({ where: eq(suppliers.id, d.id) })
  if (!current) return { ok: false, message: "Proveedor no encontrado" }

  /*
   * PRV-002 (auditoría 2026-09-14): el RUT se escribía como un campo más. Es la
   * identidad tributaria con la que la conciliación de facturas de compra
   * contrasta el emisor de cada documento (`insertPurchaseOrderInvoice`), de
   * modo que cambiarlo altera hacia atrás el criterio con el que se validaron
   * —y se seguirán validando— los documentos ya cargados. Mismo patrón que
   * `CLI-001` en clientes y `CAT-002` en productos.
   */
  try {
    await assertIdentityStable({
      fields: [{ key: "rut", label: "el RUT", before: current.rut, after: d.rut ?? null }],
      hasHistory: () => supplierHasDocuments(d.id!),
      reason: "el proveedor ya tiene órdenes de compra o documentos tributarios emitidos a ese RUT",
      remedy: "Crea otro proveedor y da de baja este cuando no queden órdenes abiertas.",
    })
  } catch (e) {
    if (e instanceof MasterIdentityError) {
      return { ok: false, fieldErrors: Object.fromEntries(e.fieldKeys.map((k) => [k, [e.message]])) }
    }
    throw e
  }

  await db.update(suppliers).set({
    name: d.name, rut: d.rut ?? null,
    businessActivity: d.businessActivity ?? null,
    contactName:  d.contactName  ?? null,
    email:        d.email        ?? null,
    phone:        d.phone        ?? null,
    address:      d.address      ?? null,
    commune:      d.commune      ?? null,
    city:         d.city         ?? null,
    paymentTerms: d.paymentTerms ?? null,
    notes:        d.notes        ?? null,
    isActive:     d.isActive,
    updatedAt:    new Date().toISOString(),
  }).where(eq(suppliers.id, d.id))

  await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "update", entityType: "supplier", entityId: d.id, oldState: { name: current.name }, newState: { name: d.name } })

  revalidatePath(REVALIDATE)
  return { ok: true, message: `Proveedor ${d.name} actualizado` }
}

export async function toggleSupplierActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:suppliers") }
  catch { return { ok: false, message: "Sin permisos" } }

  const id       = formData.get("id") as string
  const activate = formData.get("activate") === "true"
  if (!id) return { ok: false, message: "ID requerido" }

  /*
   * PRV-001 (auditoría 2026-09-14): desactivar no miraba nada, y es la mitad
   * ascendente de `OC-001` — la emisión de una OC no revalida al proveedor, así
   * que una orden en borrador cuyo proveedor se acaba de desactivar igual se
   * emite, apuntando a alguien que los selectores ya no ofrecen.
   *
   * No bloquea: dejar de trabajar con un proveedor puede ocurrir con órdenes
   * abiertas, y exigir cerrarlas todas obligaría a mantenerlo activo. Lo que sí
   * hace es mirar y dejarlo escrito, como la baja de una persona.
   */
  const dependencies = activate ? null : await getSupplierDependencies(id)

  await db.update(suppliers).set({ isActive: activate, updatedAt: new Date().toISOString() }).where(eq(suppliers.id, id))

  await recordAudit({
    userId: session.user.id, userEmail: session.user.email ?? undefined,
    action: "update", entityType: "supplier", entityId: id,
    oldState: { isActive: !activate },
    newState: {
      isActive: activate,
      ...(dependencies ? { pendientesAlDesactivar: dependencies.items } : {}),
    },
  })

  revalidatePath(REVALIDATE)
  if (activate) return { ok: true, message: "Proveedor activado" }
  return {
    ok: true,
    message: dependencies && !dependencies.clear
      ? `Proveedor desactivado. Queda pendiente con él: ${describeSupplierDependencies(dependencies)}.`
      : "Proveedor desactivado",
  }
}

export async function importSuppliersFromXlsx(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:suppliers") }
  catch { return { ok: false, message: "Sin permisos" } }

  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) return { ok: false, fieldErrors: { file: ["Selecciona un archivo Excel"] } }
  if (!file.name.toLowerCase().endsWith(".xlsx")) return { ok: false, fieldErrors: { file: ["El archivo debe estar en formato .xlsx"] } }

  const buffer = Buffer.from(await file.arrayBuffer())
  const result = await parseCatalogWorkbook(buffer)
  if (!result.ok) return { ok: false, message: result.errors.join("; ") }

  let created = 0; let updated = 0; let skipped = 0

  try {
    await db.transaction(async (tx) => {
      for (const row of result.rows) {
        const v = row.values
        const name = (v["Nombre"] ?? "").trim()
        if (!name) { skipped++; continue }
        const isActive = v["Activo"]?.trim() !== "No"

        if (row.decision === "update" && row.existingId) {
          updated++
          await tx.update(suppliers).set({
            name, rut: (v["RUT"] ?? "").trim() || null,
            businessActivity: (v["Giro"] ?? "").trim() || null,
            contactName: (v["Contacto"] ?? "").trim() || null,
            email: (v["Email"] ?? "").trim() || null,
            phone: (v["Teléfono"] ?? "").trim() || null,
            address: (v["Dirección"] ?? "").trim() || null,
            commune: (v["Comuna"] ?? "").trim() || null,
            city: (v["Ciudad"] ?? "").trim() || null,
            paymentTerms: (v["Cond. pago"] ?? "").trim() || null,
            notes: (v["Notas"] ?? "").trim() || null,
            isActive,
            updatedAt: new Date().toISOString(),
          }).where(eq(suppliers.id, row.existingId!))
        } else {
          created++
          await tx.insert(suppliers).values({
            id: nanoid(), name, rut: (v["RUT"] ?? "").trim() || null,
            businessActivity: (v["Giro"] ?? "").trim() || null,
            contactName: (v["Contacto"] ?? "").trim() || null,
            email: (v["Email"] ?? "").trim() || null,
            phone: (v["Teléfono"] ?? "").trim() || null,
            address: (v["Dirección"] ?? "").trim() || null,
            commune: (v["Comuna"] ?? "").trim() || null,
            city: (v["Ciudad"] ?? "").trim() || null,
            paymentTerms: (v["Cond. pago"] ?? "").trim() || null,
            notes: (v["Notas"] ?? "").trim() || null,
            isActive,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
        }
      }
    })
    await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "create", entityType: "supplier", entityId: "import_xlsx", newState: { created, updated, skipped } })
    revalidatePath(REVALIDATE)
    return { ok: true, message: `Importados: ${created} creados, ${updated} actualizados, ${skipped} omitidos`, data: { created, updated, skipped } }
  } catch (err) {
    logger.error("[admin/proveedores] importXlsx", err)
    return { ok: false, message: (err as Error).message }
  }
}
