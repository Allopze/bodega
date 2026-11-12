import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Las tres acciones de Catálogos exigen `mant:equipment:manage` en el servidor (el menú sólo lo
 * refleja), validan la forma de lo recibido y sólo revalidan la página cuando el cambio se hizo.
 */

const guard = vi.hoisted(() => vi.fn())
const revalidatePath = vi.hoisted(() => vi.fn())
const service = vi.hoisted(() => ({ createCatalogEntry: vi.fn(), renameCatalogEntry: vi.fn(), setCatalogEntryActive: vi.fn() }))

vi.mock("@/db", () => ({ db: {} }))
vi.mock("next/cache", () => ({ revalidatePath }))
vi.mock("@/lib/auth/can", () => ({ guardPermission: guard }))
vi.mock("@/lib/services/mantencion/catalog-admin", () => service)

const { createCatalogEntryAction, renameCatalogEntryAction, setCatalogEntryActiveAction } = await import("./actions")

const SESSION = { user: { id: "u-jefe", email: "jefe@example.test", permissions: ["mant:equipment:manage", "mant:records:view_all"], worksiteIds: [], isGlobal: true } }
/** Encargado de una faena: administra equipos, pero los catálogos son comunes a todas. */
const SCOPED = { user: { id: "u-sup", email: "sup@example.test", permissions: ["mant:equipment:manage", "mant:records:view_worksite"], worksiteIds: ["ws-bio"], isGlobal: false } }
const DENIED = { ok: false, message: "No tienes permisos para realizar esta acción" }

describe("acciones de Catálogos", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    guard.mockResolvedValue({ session: SESSION, error: null })
  })

  it("piden mant:equipment:manage con la ruta de la página como operación", async () => {
    service.createCatalogEntry.mockResolvedValue({ ok: true, data: { id: "b1", name: "Kia", reactivated: false } })
    await createCatalogEntryAction({ catalog: "brands", name: "Kia" })
    expect(guard).toHaveBeenCalledWith("mant:equipment:manage", "/mantencion/catalogos")
  })

  it("sin permiso no tocan el servicio ni revalidan", async () => {
    guard.mockResolvedValue({ session: null, error: DENIED })
    expect(await createCatalogEntryAction({ catalog: "brands", name: "Kia" })).toEqual(DENIED)
    expect(await renameCatalogEntryAction({ catalog: "brands", id: "b1", name: "Kia" })).toEqual(DENIED)
    expect(await setCatalogEntryActiveAction({ catalog: "brands", id: "b1", active: false })).toEqual(DENIED)
    expect(service.createCatalogEntry).not.toHaveBeenCalled()
    expect(service.renameCatalogEntry).not.toHaveBeenCalled()
    expect(service.setCatalogEntryActive).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("quien no ve todas las faenas no cambia catálogos comunes (revisión final)", async () => {
    guard.mockResolvedValue({ session: SCOPED, error: null })
    expect(await createCatalogEntryAction({ catalog: "brands", name: "Kia" })).toMatchObject({ ok: false, message: expect.stringContaining("comunes a todas las faenas") })
    expect(await renameCatalogEntryAction({ catalog: "brands", id: "b1", name: "Kia" })).toMatchObject({ ok: false })
    expect(await setCatalogEntryActiveAction({ catalog: "brands", id: "b1", active: false })).toMatchObject({ ok: false })
    expect(service.createCatalogEntry).not.toHaveBeenCalled()
    expect(service.renameCatalogEntry).not.toHaveBeenCalled()
    expect(service.setCatalogEntryActive).not.toHaveBeenCalled()
  })

  it("rechazan un catálogo desconocido, un id vacío y un estado que no es booleano", async () => {
    expect(await createCatalogEntryAction({ catalog: "worksites", name: "Kia" })).toMatchObject({ ok: false })
    expect(await renameCatalogEntryAction({ catalog: "brands", id: "  ", name: "Kia" })).toMatchObject({ ok: false })
    expect(await setCatalogEntryActiveAction({ catalog: "brands", id: "b1", active: "no" as unknown as boolean })).toMatchObject({ ok: false })
    expect(service.createCatalogEntry).not.toHaveBeenCalled()
    expect(service.renameCatalogEntry).not.toHaveBeenCalled()
    expect(service.setCatalogEntryActive).not.toHaveBeenCalled()
  })

  it("pasan al servicio el actor de la sesión y revalidan sólo si el cambio se hizo", async () => {
    service.setCatalogEntryActive.mockResolvedValue({ ok: true, data: { id: "b1", isActive: false } })
    await setCatalogEntryActiveAction({ catalog: "brands", id: "b1", active: false })
    expect(service.setCatalogEntryActive).toHaveBeenCalledWith({ catalog: "brands", id: "b1", active: false, actor: { userId: "u-jefe", email: "jefe@example.test" } })
    expect(revalidatePath).toHaveBeenCalledWith("/mantencion/catalogos")

    revalidatePath.mockClear()
    service.renameCatalogEntry.mockResolvedValue({ ok: false, field: "name", message: "Ya existe una marca llamada «Kia»." })
    expect(await renameCatalogEntryAction({ catalog: "brands", id: "b1", name: "Kia" })).toMatchObject({ ok: false, field: "name" })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
