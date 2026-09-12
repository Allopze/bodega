/**
 * Server actions del catálogo de tipos de activo TI.
 *
 * Lo que se prueba acá no es que guarde —eso lo cubre el test PGlite del
 * servicio—, sino lo que aporta la capa de acción: el permiso, la validación
 * del formulario, que se revalide tanto la pantalla propia como `/ti/activos`
 * (donde el tipo se consume para el selector de altas), y que el error del
 * servicio llegue sanitizado al cliente.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockUpsertAssetType = vi.hoisted(() => vi.fn())
const mockSetAssetTypeActive = vi.hoisted(() => vi.fn())
const mockRevalidatePath = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ requirePermission: mockRequirePermission }))
vi.mock("@/lib/services/ti/asset-types", () => ({
  upsertAssetType: mockUpsertAssetType,
  setAssetTypeActive: mockSetAssetTypeActive,
}))
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath, revalidateTag: vi.fn() }))

import {
  createItAssetTypeAction, updateItAssetTypeAction, setAssetTypeActiveAction,
} from "@/app/(app)/admin/tipos-activo/actions"
import type { ActionState } from "@/lib/form-state"

const prevState: ActionState = { ok: false, message: "" }

function makeSession() {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1",
      email: "ti@test.cl",
      name: "Técnico TI",
      roles: ["tecnico_ti"],
      permissions: ["admin:it_asset_types"],
      worksiteIds: [],
      primaryWorksiteId: "",
      avatarColor: "#000",
      isActive: true,
    },
  }
}

function formOf(entries: Record<string, string>) {
  const fd = new FormData()
  for (const [key, value] of Object.entries(entries)) fd.set(key, value)
  return fd
}

describe("createItAssetTypeAction", () => {
  beforeEach(() => vi.resetAllMocks())

  it("exige el permiso del catálogo", async () => {
    mockRequirePermission.mockRejectedValue(new Error("forbidden"))
    const result = await createItAssetTypeAction(prevState, formOf({ name: "Notebook", category: "computacion" }))
    expect(result.ok).toBe(false)
    expect(mockUpsertAssetType).not.toHaveBeenCalled()
  })

  it("rechaza un nombre demasiado corto sin llamar al servicio", async () => {
    mockRequirePermission.mockResolvedValue(makeSession())
    const result = await createItAssetTypeAction(prevState, formOf({ name: "N", category: "computacion" }))
    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.name).toBeDefined()
    expect(mockUpsertAssetType).not.toHaveBeenCalled()
  })

  it("rechaza una categoría fuera del catálogo", async () => {
    mockRequirePermission.mockResolvedValue(makeSession())
    const result = await createItAssetTypeAction(prevState, formOf({ name: "Notebook", category: "inventada" }))
    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.category).toBeDefined()
    expect(mockUpsertAssetType).not.toHaveBeenCalled()
  })

  it("crea y revalida tanto la pantalla propia como /ti/activos", async () => {
    mockRequirePermission.mockResolvedValue(makeSession())
    mockUpsertAssetType.mockResolvedValue("iat-1")

    const result = await createItAssetTypeAction(prevState, formOf({ name: "Notebook", category: "computacion" }))

    expect(result.ok).toBe(true)
    expect(mockUpsertAssetType).toHaveBeenCalledWith(
      { name: "Notebook", category: "computacion", hasSpecs: false },
      expect.objectContaining({ userId: "user-1" }),
    )
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/tipos-activo")
    expect(mockRevalidatePath).toHaveBeenCalledWith("/ti/activos")
  })

  it("devuelve el mensaje del servicio cuando falla", async () => {
    mockRequirePermission.mockResolvedValue(makeSession())
    mockUpsertAssetType.mockRejectedValue(new Error("Ya existe un tipo de activo con ese nombre"))
    const result = await createItAssetTypeAction(prevState, formOf({ name: "Notebook", category: "computacion" }))
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/Ya existe un tipo de activo/)
  })
})

describe("updateItAssetTypeAction", () => {
  beforeEach(() => vi.resetAllMocks())

  it("exige id", async () => {
    mockRequirePermission.mockResolvedValue(makeSession())
    const result = await updateItAssetTypeAction(prevState, formOf({ name: "Notebook", category: "computacion" }))
    expect(result.ok).toBe(false)
    expect(mockUpsertAssetType).not.toHaveBeenCalled()
  })

  it("edita pasando el id al servicio", async () => {
    mockRequirePermission.mockResolvedValue(makeSession())
    mockUpsertAssetType.mockResolvedValue("iat-1")

    const result = await updateItAssetTypeAction(prevState, formOf({
      id: "iat-1", name: "Notebook 14\"", category: "computacion", hasSpecs: "on",
    }))

    expect(result.ok).toBe(true)
    expect(mockUpsertAssetType).toHaveBeenCalledWith(
      { id: "iat-1", name: "Notebook 14\"", category: "computacion", hasSpecs: true },
      expect.anything(),
    )
  })
})

describe("setAssetTypeActiveAction", () => {
  beforeEach(() => vi.resetAllMocks())

  it("exige el permiso del catálogo", async () => {
    mockRequirePermission.mockRejectedValue(new Error("forbidden"))
    const result = await setAssetTypeActiveAction(prevState, formOf({ id: "iat-1", activate: "false" }))
    expect(result.ok).toBe(false)
    expect(mockSetAssetTypeActive).not.toHaveBeenCalled()
  })

  it("lee 'activate' como booleano y llama al servicio", async () => {
    mockRequirePermission.mockResolvedValue(makeSession())
    mockSetAssetTypeActive.mockResolvedValue({ id: "iat-1", name: "Notebook", isActive: false })

    const result = await setAssetTypeActiveAction(prevState, formOf({ id: "iat-1", activate: "false" }))

    expect(result.ok).toBe(true)
    expect(mockSetAssetTypeActive).toHaveBeenCalledWith("iat-1", false, expect.objectContaining({ userId: "user-1" }))
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/tipos-activo")
    expect(mockRevalidatePath).toHaveBeenCalledWith("/ti/activos")
  })

  it("propaga el error si el tipo no existe", async () => {
    mockRequirePermission.mockResolvedValue(makeSession())
    mockSetAssetTypeActive.mockRejectedValue(new Error("Tipo de activo no encontrado"))
    const result = await setAssetTypeActiveAction(prevState, formOf({ id: "iat-x", activate: "true" }))
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/no encontrado/)
  })
})
