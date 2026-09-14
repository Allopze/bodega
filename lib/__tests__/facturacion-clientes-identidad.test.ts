/**
 * Clientes y contratos de facturación, contra PostgreSQL real (PGlite).
 *
 * Tres hallazgos de la auditoría 2026-09-14 que viven en el mismo punto:
 *
 *  - `CLI-001` (P1): el RUT del cliente y el cliente de un contrato se escribían
 *    sin comprobar historia facturada. La factura de venta apunta a ambos por
 *    clave foránea, así que cambiar un RUT no corrige un error de tipeo:
 *    reasigna el titular de todo lo emitido.
 *  - `CLI-002`: editar un id inexistente respondía «actualizado» y registraba en
 *    la bitácora un cambio que no ocurrió.
 *  - `CLI-003`: la auditoría guardaba `newState` sin `oldState`, es decir, sin
 *    el único dato con el que se puede detectar y revertir el cambio.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { computeRutDv } from "@/lib/rut"
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

const { saveClientAction, saveContractAction } = await import("@/app/(app)/facturacion/actions")

const USER = "user-cli-1"

/**
 * `clients.rut` es único global, así que cada fixture necesita el suyo. Se
 * generan en forma canónica (sin puntos) con el dígito verificador real: la
 * acción valida el módulo 11 antes de llegar a la guarda de identidad, y un RUT
 * inventado haría fallar la prueba por el motivo equivocado.
 */
let rutSeq = 70_000_000
const nextRut = () => {
  const body = String(++rutSeq)
  return `${body}-${computeRutDv(body)}`
}

function session(perm = "billing:manage_clients"): Session {
  return {
    user: {
      id: USER, name: "Admin", email: "admin@chome.cl",
      permissions: [perm], roles: ["administrador"], worksiteIds: [], isGlobal: true,
    },
    expires: new Date(Date.now() + 86_400_000).toISOString(),
  } as unknown as Session
}

async function seedClient(name: string) {
  const id = nanoid()
  const rut = nextRut()
  await inMemoryDb.insert(schema.clients).values({ id, rut, name, isActive: true })
  return { id, rut }
}

async function seedContract(clientId: string, code = `CT-${nanoid(5).toUpperCase()}`) {
  const id = nanoid()
  await inMemoryDb.insert(schema.contracts).values({ id, code, clientId, name: "Contrato" })
  return { id, code }
}

/** Una propuesta cuelga del cliente y del contrato: sirve como historia. */
async function seedProposal(clientId: string, contractId?: string) {
  await inMemoryDb.insert(schema.billingProposals).values({
    id: nanoid(), code: `PF-${nanoid(5).toUpperCase()}`, clientId,
    contractId: contractId ?? null, servicePeriod: "2026-08", createdBy: USER,
  })
}

const clientForm = (fields: Record<string, unknown>) => ({
  name: "Cliente", defaultCurrency: "CLP", isActive: true, ...fields,
})
const contractForm = (fields: Record<string, unknown>) => ({
  code: "CT-X", name: "Contrato", currency: "CLP",
  billingCycle: "monthly", status: "active", ...fields,
})

const rutOf = async (id: string) =>
  (await inMemoryDb.select({ r: schema.clients.rut })
    .from(schema.clients).where(eq(schema.clients.id, id)))[0]?.r

const clientOfContract = async (id: string) =>
  (await inMemoryDb.select({ c: schema.contracts.clientId })
    .from(schema.contracts).where(eq(schema.contracts.id, id)))[0]?.c

const lastAudit = () => mockRecordAudit.mock.calls.at(-1)?.[0] as
  { oldState?: Record<string, unknown>; newState?: Record<string, unknown> } | undefined

beforeAll(async () => {
  await inMemoryDb.insert(schema.users).values({
    id: USER, name: "Admin", email: "admin@chome.cl", hashedPassword: "x", isActive: true,
  })
})

beforeEach(() => {
  vi.clearAllMocks()
  mockAuthFn.mockResolvedValue(session())
  mockRecordAudit.mockResolvedValue(undefined)
})

describe("CLI-001 — identidad tributaria del cliente", () => {
  it("un cliente sin historia puede corregir su RUT", async () => {
    const { id } = await seedClient("Sin historia")
    const nuevo = nextRut()
    const result = await saveClientAction(clientForm({ id, name: "Sin historia", rut: nuevo }))
    expect(result.ok).toBe(true)
    expect(await rutOf(id)).toBe(nuevo)
  })

  it("con propuestas emitidas, cambiar el RUT se rechaza y no se escribe", async () => {
    const { id, rut } = await seedClient("Con historia")
    await seedProposal(id)
    const nuevo = nextRut()

    const result = await saveClientAction(clientForm({ id, name: "Con historia", rut: nuevo }))
    expect(result.ok).toBe(false)
    expect(result.message).toContain("el RUT")
    expect(result.message).toContain(`«${rut}» → «${nuevo}»`)
    expect(result.message).toContain("Crea otro cliente")
    expect(await rutOf(id)).toBe(rut)
  })

  it("un contrato asociado también cuenta como historia del cliente", async () => {
    const { id } = await seedClient("Con contrato")
    await seedContract(id)
    expect((await saveClientAction(clientForm({ id, name: "Con contrato", rut: nextRut() }))).ok).toBe(false)
  })

  it("con historia, el nombre y el plazo de pago se siguen corrigiendo", async () => {
    const { id, rut } = await seedClient("Nombre malo")
    await seedProposal(id)
    const result = await saveClientAction(clientForm({
      id, name: "Nombre bueno", rut, paymentTermsDays: 30,
    }))
    expect(result.ok).toBe(true)
  })
})

describe("CLI-001 — el cliente de un contrato", () => {
  it("sin facturación, el contrato se puede reapuntar", async () => {
    const a = await seedClient("Cliente A")
    const b = await seedClient("Cliente B")
    const contract = await seedContract(a.id)

    const result = await saveContractAction(contractForm({
      id: contract.id, code: contract.code, clientId: b.id,
    }))
    expect(result.ok).toBe(true)
    expect(await clientOfContract(contract.id)).toBe(b.id)
  })

  it("con propuestas, reapuntarlo se rechaza: movería esa facturación", async () => {
    const a = await seedClient("Cliente A2")
    const b = await seedClient("Cliente B2")
    const contract = await seedContract(a.id)
    await seedProposal(a.id, contract.id)

    const result = await saveContractAction(contractForm({
      id: contract.id, code: contract.code, clientId: b.id,
    }))
    expect(result.ok).toBe(false)
    expect(result.message).toContain("el cliente del contrato")
    expect(await clientOfContract(contract.id)).toBe(a.id)
  })
})

describe("CLI-002 — editar algo que ya no existe", () => {
  it("un cliente inexistente no responde «actualizado»", async () => {
    const result = await saveClientAction(clientForm({ id: "no-existe", name: "Fantasma", rut: nextRut() }))
    expect(result.ok).toBe(false)
    expect(result.message).toContain("ya no existe")
    expect(mockRecordAudit).not.toHaveBeenCalled()   // ni deja rastro de un cambio que no ocurrió
  })

  it("un contrato inexistente tampoco", async () => {
    const cliente = await seedClient("Cliente C")
    const result = await saveContractAction(contractForm({ id: "no-existe", clientId: cliente.id }))
    expect(result.ok).toBe(false)
    expect(result.message).toContain("ya no existe")
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })
})

describe("CLI-003 — el estado anterior en la bitácora", () => {
  it("una edición de cliente guarda lo que había antes", async () => {
    const { id, rut } = await seedClient("Antes")
    await saveClientAction(clientForm({ id, name: "Después", rut, isActive: false }))

    expect(lastAudit()?.oldState).toMatchObject({ name: "Antes", rut, isActive: true })
    expect(lastAudit()?.newState).toMatchObject({ name: "Después", isActive: false })
  })

  it("una edición de contrato también", async () => {
    const cliente = await seedClient("Cliente D")
    const contract = await seedContract(cliente.id, "CT-ANTES")
    await saveContractAction(contractForm({
      id: contract.id, code: "CT-ANTES", clientId: cliente.id, status: "closed",
    }))

    expect(lastAudit()?.oldState).toMatchObject({ code: "CT-ANTES", clientId: cliente.id, status: "active" })
    expect(lastAudit()?.newState).toMatchObject({ status: "closed" })
  })

  it("un alta no inventa un estado anterior", async () => {
    await saveClientAction(clientForm({ name: "Nuevo", rut: nextRut() }))
    expect(lastAudit()?.oldState).toBeUndefined()
  })
})
