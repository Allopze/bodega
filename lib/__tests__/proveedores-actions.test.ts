/**
 * Acciones de administración de proveedores, contra PostgreSQL real (PGlite).
 *
 * La versión anterior de este archivo simulaba `db` con mocks encadenados:
 * comprobaba que se llamara a `update`, no lo que quedaba escrito. `PRV-001` y
 * `PRV-002` (auditoría 2026-09-14) viven justamente en lo que no se consultaba
 * antes de escribir, así que aquí se ejercita el SQL de verdad.
 *
 * Cubre: RBAC, validación, alta, edición, identidad del RUT (`PRV-002`) y
 * desactivación con dependencias abiertas (`PRV-001`).
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { nanoid } from "@/lib/id"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite es estructuralmente compatible en runtime.
testGlobal.__db = inMemoryDb

const mockAuthFn = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn())

vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/audit", () => ({ recordAudit: mockRecordAudit }))
vi.mock("@/lib/services/module-toggles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/module-toggles")>()),
  assertPermissionModuleEnabled: vi.fn(async () => {}),
  assertRouteModuleEnabled: vi.fn(async () => {}),
  getNavigationToggleState: vi.fn(async () => ({ enabledModuleIds: new Set<string>(), disabledSubmoduleHrefs: new Set<string>() })),
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { createSupplier, updateSupplier, toggleSupplierActive } =
  await import("@/app/(app)/admin/proveedores/actions")

const USER = "user-prv-1"
const WS = "ws-prv-1"

function session(perm: string): Session {
  return {
    user: {
      id: USER, name: "Admin", email: "admin@chome.cl",
      permissions: [perm], roles: ["administrador"], worksiteIds: [], isGlobal: true,
    },
    expires: new Date(Date.now() + 86_400_000).toISOString(),
  } as unknown as Session
}

async function seedSupplier(name: string, rut: string | null = null) {
  const id = nanoid()
  await inMemoryDb.insert(schema.suppliers).values({ id, name, rut, isActive: true })
  return id
}

async function seedOrder(supplierId: string, status: string, options: {
  reconciliation?: string
} = {}) {
  const id = nanoid()
  const code = `OC-${nanoid(6).toUpperCase()}`
  await inMemoryDb.insert(schema.purchaseOrders).values({
    id, code, supplierId, worksiteId: WS, createdBy: USER, status,
    invoiceReconciliationStatus: options.reconciliation ?? "no_invoices",
  })
  return { id, code }
}

function form(fields: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

const isActive = async (id: string) =>
  (await inMemoryDb.select({ a: schema.suppliers.isActive })
    .from(schema.suppliers).where(eq(schema.suppliers.id, id)))[0]?.a

const rutOf = async (id: string) =>
  (await inMemoryDb.select({ r: schema.suppliers.rut })
    .from(schema.suppliers).where(eq(schema.suppliers.id, id)))[0]?.r

/** El `newState` del último `recordAudit`, que es donde queda la constancia. */
const lastAuditNewState = () =>
  mockRecordAudit.mock.calls.at(-1)?.[0]?.newState as Record<string, unknown> | undefined

beforeAll(async () => {
  await inMemoryDb.insert(schema.users).values({
    id: USER, name: "Admin", email: "admin@chome.cl", hashedPassword: "x", isActive: true,
  })
  await inMemoryDb.insert(schema.worksites).values({
    id: WS, name: "Faena Proveedores", code: "PRV", isActive: true,
  })
})

beforeEach(() => {
  vi.clearAllMocks()
  mockAuthFn.mockResolvedValue(session("admin:suppliers"))
  mockRecordAudit.mockResolvedValue(undefined)
})

describe("createSupplier", () => {
  it("rechaza sin el permiso", async () => {
    mockAuthFn.mockResolvedValue(session("other:perm"))
    expect((await createSupplier({ ok: false }, form({ name: "X" }))).ok).toBe(false)
  })

  it("rechaza sin nombre", async () => {
    expect((await createSupplier({ ok: false }, form({ name: "" }))).ok).toBe(false)
  })

  it("crea el proveedor y lo deja en la base", async () => {
    const result = await createSupplier({ ok: false }, form({
      name: "Ferretería Nueva", rut: "76.111.222-8", isActive: "on",
    }))
    expect(result.ok).toBe(true)
    const rows = await inMemoryDb.select().from(schema.suppliers)
    expect(rows.some((r) => r.name === "Ferretería Nueva")).toBe(true)
  })

  it("rechaza un RUT ya registrado", async () => {
    await seedSupplier("Ya existe", "77999888-6")
    const result = await createSupplier({ ok: false }, form({
      name: "Otro", rut: "77.999.888-6", isActive: "on",
    }))
    expect(result.ok).toBe(false)
  })
})

describe("updateSupplier", () => {
  it("rechaza sin el permiso y con un id inexistente", async () => {
    mockAuthFn.mockResolvedValue(session("other:perm"))
    expect((await updateSupplier({ ok: false }, form({ id: "x", name: "N" }))).ok).toBe(false)

    mockAuthFn.mockResolvedValue(session("admin:suppliers"))
    const result = await updateSupplier({ ok: false }, form({ id: "no-existe", name: "Nombre", isActive: "on" }))
    expect(result.ok).toBe(false)
    expect(result.message ?? "").toContain("no encontrado")
  })

  it("actualiza los datos corrientes", async () => {
    const id = await seedSupplier("Nombre viejo")
    const result = await updateSupplier({ ok: false }, form({ id, name: "Nombre nuevo", isActive: "on" }))
    expect(result.ok).toBe(true)
    const [row] = await inMemoryDb.select({ n: schema.suppliers.name })
      .from(schema.suppliers).where(eq(schema.suppliers.id, id))
    expect(row?.n).toBe("Nombre nuevo")
  })

  /**
   * PRV-002: el RUT es la identidad con la que la conciliación contrasta el
   * emisor de cada factura de compra. Cambiarlo altera hacia atrás el criterio
   * con el que se validaron los documentos ya cargados.
   */
  it("un proveedor sin historia sí puede corregir su RUT", async () => {
    const id = await seedSupplier("Recién creado", "76100100-0")
    const result = await updateSupplier({ ok: false }, form({
      id, name: "Recién creado", rut: "76.200.200-0", isActive: "on",
    }))
    expect(result.ok).toBe(true)
    expect(await rutOf(id)).toBe("76200200-0")
  })

  it("con órdenes emitidas, cambiar el RUT se rechaza sobre su campo", async () => {
    const id = await seedSupplier("Con historia", "76300300-0")
    await seedOrder(id, "sent")

    const result = await updateSupplier({ ok: false }, form({
      id, name: "Con historia", rut: "76.400.400-0", isActive: "on",
    }))
    expect(result.ok).toBe(false)
    const mensaje = result.fieldErrors?.rut?.[0] ?? ""
    expect(mensaje).toContain("el RUT")
    expect(mensaje).toContain("«76300300-0» → «76400400-0»")
    expect(mensaje).toContain("Crea otro proveedor")
    expect(await rutOf(id)).toBe("76300300-0")
  })

  it("con órdenes emitidas, el nombre y el contacto se siguen corrigiendo", async () => {
    const id = await seedSupplier("Nombre mal escrito", "76500500-0")
    await seedOrder(id, "received")
    const result = await updateSupplier({ ok: false }, form({
      id, name: "Nombre bien escrito", rut: "76.500.500-0", phone: "+56 9 1234 5678", isActive: "on",
    }))
    expect(result.ok).toBe(true)
  })
})

/**
 * PRV-001: es la mitad ascendente de `OC-001` — la emisión no revalida al
 * proveedor, así que una OC en borrador de un proveedor recién desactivado
 * igual se puede emitir, apuntando a alguien que los selectores ya no ofrecen.
 */
describe("toggleSupplierActive", () => {
  it("rechaza sin el permiso", async () => {
    mockAuthFn.mockResolvedValue(session("other:perm"))
    expect((await toggleSupplierActive({ ok: false }, form({ id: "x", activate: "true" }))).ok).toBe(false)
  })

  it("un proveedor sin nada abierto se desactiva sin más", async () => {
    const id = await seedSupplier("Sin pendientes")
    const result = await toggleSupplierActive({ ok: false }, form({ id, activate: "false" }))
    expect(result.ok).toBe(true)
    expect(result.message).toBe("Proveedor desactivado")
    expect(await isActive(id)).toBe(false)
  })

  it("con pendientes se desactiva igual, pero los nombra y los deja en la auditoría", async () => {
    const id = await seedSupplier("Con pendientes")
    const borrador = await seedOrder(id, "draft")
    await seedOrder(id, "sent")
    await seedOrder(id, "partially_received")

    const result = await toggleSupplierActive({ ok: false }, form({ id, activate: "false" }))

    // No bloquea: dejar de trabajar con alguien puede ocurrir con órdenes vivas.
    expect(result.ok).toBe(true)
    expect(await isActive(id)).toBe(false)

    expect(result.message).toContain("1 orden en borrador")
    expect(result.message).toContain("2 órdenes emitidas sin recibir del todo")

    const pendientes = lastAuditNewState()?.pendientesAlDesactivar as { kind: string; samples: string[] }[]
    expect(pendientes.map((p) => p.kind)).toEqual(["draft_orders", "open_orders"])
    expect(pendientes[0]!.samples).toContain(borrador.code)
  })

  it("las órdenes cerradas o anuladas ya no son pendientes", async () => {
    const id = await seedSupplier("Historia cerrada")
    await seedOrder(id, "closed")
    await seedOrder(id, "cancelled")
    await seedOrder(id, "received")

    const result = await toggleSupplierActive({ ok: false }, form({ id, activate: "false" }))
    expect(result.message).toBe("Proveedor desactivado")
  })

  it("una factura sin conciliar cuenta como pendiente; una aceptada como excepción, no", async () => {
    const id = await seedSupplier("Con facturas")
    const sinConciliar = await seedOrder(id, "closed", { reconciliation: "needs_review" })
    await inMemoryDb.insert(schema.purchaseOrderInvoices).values({
      id: nanoid(), purchaseOrderId: sinConciliar.id, invoiceNumber: "F-1",
      fileName: "f1.pdf", filePath: "storage/f1.pdf", uploadedBy: USER,
    })
    const aceptada = await seedOrder(id, "closed", { reconciliation: "accepted_exception" })
    await inMemoryDb.insert(schema.purchaseOrderInvoices).values({
      id: nanoid(), purchaseOrderId: aceptada.id, invoiceNumber: "F-2",
      fileName: "f2.pdf", filePath: "storage/f2.pdf", uploadedBy: USER,
    })

    const result = await toggleSupplierActive({ ok: false }, form({ id, activate: "false" }))
    expect(result.message).toContain("1 orden con factura sin conciliar")
    const pendientes = lastAuditNewState()?.pendientesAlDesactivar as { samples: string[] }[]
    expect(pendientes.at(-1)!.samples).toEqual([sinConciliar.code])
  })

  it("reactivar no consulta nada ni cambia el mensaje", async () => {
    const id = await seedSupplier("Para reactivar")
    await seedOrder(id, "draft")
    await inMemoryDb.update(schema.suppliers).set({ isActive: false })
      .where(eq(schema.suppliers.id, id))

    const result = await toggleSupplierActive({ ok: false }, form({ id, activate: "true" }))
    expect(result.message).toBe("Proveedor activado")
    expect(lastAuditNewState()?.pendientesAlDesactivar).toBeUndefined()
  })
})
