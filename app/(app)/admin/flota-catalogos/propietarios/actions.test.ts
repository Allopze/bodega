import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Catálogo de empresas propietarias: las tres acciones piden `admin:fleet_catalog`, devuelven el
 * error de cada campo donde corresponde y sólo refrescan `/flota` cuando algo cambió de verdad.
 */

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  revalidatePath: vi.fn(),
  createOwner: vi.fn(),
  updateOwner: vi.fn(),
  setActive: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath, revalidateTag: vi.fn() }))
vi.mock("@/lib/auth/can", () => ({ requirePermission: mocks.requirePermission }))
vi.mock("@/db", () => ({ db: { transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({}) } }))
vi.mock("@/lib/services/fleet-owners", () => ({
  createFleetOwnerTx: mocks.createOwner,
  updateFleetOwnerTx: mocks.updateOwner,
  setFleetOwnerActiveTx: mocks.setActive,
}))

const { createFleetOwnerCatalogAction, updateFleetOwnerCatalogAction, setFleetOwnerActiveAction } = await import("./actions")

const SESSION = { user: { id: "u-1", email: "admin@chome.test" } }
const PREV = { ok: false } as const

function form(values: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePermission.mockResolvedValue(SESSION)
  mocks.createOwner.mockResolvedValue({ ok: true, message: "Empresa Servimar creada.", data: { id: "o-new", created: true } })
  mocks.updateOwner.mockResolvedValue({ ok: true, message: "Empresa ASIR actualizada.", data: { changed: true } })
  mocks.setActive.mockResolvedValue({ ok: true, message: "Empresa ASIR desactivada.", data: { changed: true, name: "ASIR" } })
})

describe("permiso", () => {
  it("las tres acciones piden admin:fleet_catalog y, sin él, no escriben", async () => {
    mocks.requirePermission.mockRejectedValue(new Error("Forbidden"))
    const results = await Promise.all([
      createFleetOwnerCatalogAction(PREV, form({ name: "Servimar", kind: "relacionada" })),
      updateFleetOwnerCatalogAction(PREV, form({ id: "o-1", name: "ASIR", kind: "relacionada" })),
      setFleetOwnerActiveAction(PREV, form({ id: "o-1", activate: "false" })),
    ])
    for (const result of results) expect(result).toEqual({ ok: false, message: "Sin permisos" })
    expect(mocks.requirePermission).toHaveBeenCalledWith("admin:fleet_catalog")
    expect(mocks.createOwner).not.toHaveBeenCalled()
    expect(mocks.updateOwner).not.toHaveBeenCalled()
    expect(mocks.setActive).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})

describe("createFleetOwnerCatalogAction", () => {
  it("crea la empresa y refresca el catálogo y todo /flota", async () => {
    const result = await createFleetOwnerCatalogAction(PREV, form({ name: "Servimar", kind: "relacionada" }))
    expect(result).toMatchObject({ ok: true, data: { id: "o-new" } })
    expect(mocks.createOwner).toHaveBeenCalledWith({}, { userId: "u-1", email: "admin@chome.test" }, { name: "Servimar", kind: "relacionada" })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/flota-catalogos/propietarios")
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/flota", "layout")
  })

  it("nombre corto o tipo inválido devuelven el error en su campo y no llegan al servicio", async () => {
    const short = await createFleetOwnerCatalogAction(PREV, form({ name: "A", kind: "tercero" }))
    expect(short.ok).toBe(false)
    expect(short.fieldErrors?.name?.[0]).toMatch(/mínimo 2 letras/)
    const badKind = await createFleetOwnerCatalogAction(PREV, form({ name: "Servimar", kind: "inventada" }))
    expect(badKind.fieldErrors?.kind?.[0]).toBe("Elige el tipo de empresa")
    expect(mocks.createOwner).not.toHaveBeenCalled()
  })

  it("si el nombre ya existe lo dice en el campo (en la ficha se reutiliza; aquí es un error) y no refresca", async () => {
    mocks.createOwner.mockResolvedValue({ ok: true, message: "La empresa ASIR ya existía: se usó esa.", data: { id: "o-1", created: false } })
    const result = await createFleetOwnerCatalogAction(PREV, form({ name: "asir", kind: "relacionada" }))
    expect(result).toMatchObject({ ok: false, fieldErrors: { name: ["Ya existe una empresa con ese nombre."] } })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("un error del servicio se pinta en el campo que indica", async () => {
    mocks.createOwner.mockResolvedValue({ ok: false, message: "La empresa Banco existe pero está inactiva.", field: "name" })
    const result = await createFleetOwnerCatalogAction(PREV, form({ name: "Banco", kind: "financiera" }))
    expect(result).toMatchObject({ ok: false, fieldErrors: { name: ["La empresa Banco existe pero está inactiva."] } })
  })

  it("una violación de unicidad por carrera se traduce a un mensaje legible, sin filtrar el SQL", async () => {
    mocks.createOwner.mockRejectedValue(Object.assign(new Error("Failed query: insert into fleet_owners"), { cause: { code: "23505" } }))
    const result = await createFleetOwnerCatalogAction(PREV, form({ name: "Servimar", kind: "relacionada" }))
    expect(result).toMatchObject({ ok: false, fieldErrors: { name: ["Ya existe una empresa con ese nombre."] } })
    expect(JSON.stringify(result)).not.toContain("insert into")
  })
})

describe("updateFleetOwnerCatalogAction", () => {
  it("renombra y refresca; sin id rechaza", async () => {
    const result = await updateFleetOwnerCatalogAction(PREV, form({ id: "o-1", name: "ASIR y Acuña", kind: "relacionada" }))
    expect(result).toEqual({ ok: true, message: "Empresa ASIR actualizada." })
    expect(mocks.updateOwner).toHaveBeenCalledWith({}, { userId: "u-1", email: "admin@chome.test" }, { id: "o-1", name: "ASIR y Acuña", kind: "relacionada" })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/flota", "layout")

    expect(await updateFleetOwnerCatalogAction(PREV, form({ name: "ASIR", kind: "relacionada" }))).toEqual({ ok: false, message: "ID requerido" })
  })

  it("sin cambios no refresca nada", async () => {
    mocks.updateOwner.mockResolvedValue({ ok: true, message: "No había cambios que guardar.", data: { changed: false } })
    const result = await updateFleetOwnerCatalogAction(PREV, form({ id: "o-1", name: "ASIR", kind: "relacionada" }))
    expect(result.ok).toBe(true)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("el choque con otra empresa se muestra en el campo nombre", async () => {
    mocks.updateOwner.mockResolvedValue({ ok: false, message: "Ya existe la empresa Chome.", field: "name" })
    const result = await updateFleetOwnerCatalogAction(PREV, form({ id: "o-1", name: "chome", kind: "relacionada" }))
    expect(result).toMatchObject({ ok: false, message: "Ya existe la empresa Chome.", fieldErrors: { name: ["Ya existe la empresa Chome."] } })
  })
})

describe("setFleetOwnerActiveAction", () => {
  it("lee id y activate del formulario oculto de la lista", async () => {
    await setFleetOwnerActiveAction(PREV, form({ id: "o-1", activate: "false" }))
    await setFleetOwnerActiveAction(PREV, form({ id: "o-1", activate: "true" }))
    expect(mocks.setActive).toHaveBeenNthCalledWith(1, {}, { userId: "u-1", email: "admin@chome.test" }, { id: "o-1", isActive: false })
    expect(mocks.setActive).toHaveBeenNthCalledWith(2, {}, { userId: "u-1", email: "admin@chome.test" }, { id: "o-1", isActive: true })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/flota", "layout")
  })

  it("sin id rechaza; una empresa inexistente devuelve el mensaje del servicio", async () => {
    expect(await setFleetOwnerActiveAction(PREV, form({ activate: "true" }))).toEqual({ ok: false, message: "ID requerido" })
    mocks.setActive.mockResolvedValue({ ok: false, message: "Esa empresa propietaria no existe." })
    expect(await setFleetOwnerActiveAction(PREV, form({ id: "x", activate: "true" }))).toEqual({ ok: false, message: "Esa empresa propietaria no existe." })
  })
})
