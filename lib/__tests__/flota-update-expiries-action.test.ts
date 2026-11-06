/**
 * `updateVehicleExpiriesAction`: la hoja «Actualizar vencimientos» de la ficha del equipo.
 *
 * Unitaria, con la base simulada (como `actions-vehicles.test.ts`): fija el permiso, el alcance de
 * faena, las tres formas de un campo (ausente / vacío / con fecha) y la auditoría de las cuatro
 * columnas. El recorrido real por el navegador es `e2e/flota-documentos.spec.ts`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockFindVehicle = vi.hoisted(() => vi.fn())
const mockUpdateWhere = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => undefined))
const mockUpdateSet = vi.hoisted(() => vi.fn((..._args: unknown[]) => ({ where: mockUpdateWhere })))
const mockRecordAudit = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => undefined))
const mockRevalidatePath = vi.hoisted(() => vi.fn())

vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath, revalidateTag: vi.fn() }))
vi.mock("@/lib/auth/can", () => ({ requirePermission: mockRequirePermission, can: vi.fn(() => true) }))
vi.mock("@/db", () => ({
  db: {
    query: { fuelVehicles: { findFirst: (...args: unknown[]) => mockFindVehicle(...args) } },
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({ update: () => ({ set: mockUpdateSet }) }),
  },
}))
vi.mock("@/lib/audit", () => ({ recordAudit: mockRecordAudit }))
vi.mock("@/lib/services/fleet", () => ({
  uploadFleetDocument: vi.fn(),
  deleteFleetDocument: vi.fn(),
  getFleetOverview: vi.fn(),
  getFleetProviderGapMonths: vi.fn(),
  FLEET_OVERVIEW_LOOKBACK_MONTHS: 12,
}))
vi.mock("@/lib/services/system-settings", () => ({ getFleetAdminSettings: vi.fn(async () => ({ warningDays: 30 })) }))
vi.mock("@/lib/storage/config", () => ({
  resolveFleetDir: vi.fn(() => "/tmp/test-fleet"),
  createFleetDocumentPath: vi.fn((name: string) => `fleet/${name}`),
  resolveStorageFile: (dir: string, name: string) => `${dir}/${name}`,
}))
vi.mock("node:fs", () => ({ promises: { mkdir: vi.fn(), writeFile: vi.fn(), unlink: vi.fn() } }))
vi.mock("@/lib/file-validation", () => ({
  validateFileBuffer: vi.fn(() => ({ error: null, mimeType: "application/pdf" })),
  MimeType: { PROOF: "application/pdf" },
}))

import { updateVehicleExpiriesAction } from "@/app/(app)/flota/actions"
import type { ActionState } from "@/lib/validation/operations"

const prev: ActionState = { ok: false, message: "" }

const scoped = { user: { id: "user-1", email: "jefa@chome.cl", isGlobal: false, worksiteIds: ["ws-1"], roles: [] } }
const global = { user: { id: "user-1", email: "jefa@chome.cl", isGlobal: true, worksiteIds: [], roles: [] } }

/** Un equipo con las cuatro fechas cargadas. */
const vehicle = {
  id: "veh-1",
  plate: "BPDH-67",
  code: "KA-90",
  worksiteId: "ws-1",
  soapExpiresAt: "2026-12-31",
  circulationPermitExpiresAt: "2027-03-31",
  technicalReviewExpiresAt: "2026-11-30",
  insuranceExpiresAt: "2027-01-15",
}

function form(fields: Record<string, string>) {
  const data = new FormData()
  data.set("vehicleId", "veh-1")
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequirePermission.mockResolvedValue(scoped)
  mockFindVehicle.mockResolvedValue(vehicle)
})

describe("updateVehicleExpiriesAction · permiso y alcance", () => {
  it("exige el permiso de documentos de flota", async () => {
    await updateVehicleExpiriesAction(prev, form({ technicalReviewExpiresAt: "2027-11-30" }))

    expect(mockRequirePermission).toHaveBeenCalledWith("flota:manage_documents")
  })

  it("sin el permiso no toca la base: ni lee el equipo ni escribe", async () => {
    mockRequirePermission.mockRejectedValue(new Error("forbidden"))

    const result = await updateVehicleExpiriesAction(prev, form({ technicalReviewExpiresAt: "2027-11-30" }))

    expect(result).toMatchObject({ ok: false })
    expect(mockFindVehicle).not.toHaveBeenCalled()
    expect(mockUpdateSet).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it("un equipo de otra faena no se puede actualizar (no basta con esconder el botón)", async () => {
    mockFindVehicle.mockResolvedValue({ ...vehicle, worksiteId: "ws-2" })

    const result = await updateVehicleExpiriesAction(prev, form({ technicalReviewExpiresAt: "2027-11-30" }))

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/faena/i)
    expect(mockUpdateSet).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it("quien ve todas las faenas puede actualizar el de cualquiera", async () => {
    mockRequirePermission.mockResolvedValue(global)
    mockFindVehicle.mockResolvedValue({ ...vehicle, worksiteId: "ws-2" })

    const result = await updateVehicleExpiriesAction(prev, form({ technicalReviewExpiresAt: "2027-11-30" }))

    expect(result.ok).toBe(true)
    expect(mockUpdateSet).toHaveBeenCalled()
  })

  it("un equipo inexistente se informa, no se inventa", async () => {
    mockFindVehicle.mockResolvedValue(undefined)

    const result = await updateVehicleExpiriesAction(prev, form({ technicalReviewExpiresAt: "2027-11-30" }))

    expect(result).toMatchObject({ ok: false, message: "Vehículo no encontrado" })
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })
})

describe("updateVehicleExpiriesAction · qué se guarda", () => {
  it("guarda la fecha nueva y no toca las columnas que no viajan", async () => {
    const result = await updateVehicleExpiriesAction(prev, form({ technicalReviewExpiresAt: "2027-11-30" }))

    expect(result).toMatchObject({ ok: true, message: "Vencimiento actualizado" })
    const patch = mockUpdateSet.mock.calls[0]?.[0] as Record<string, unknown>
    expect(Object.keys(patch).sort()).toEqual(["technicalReviewExpiresAt", "updatedAt"])
    expect(patch.technicalReviewExpiresAt).toBe("2027-11-30")
  })

  it("un campo vacío quita la fecha: se guarda null", async () => {
    const result = await updateVehicleExpiriesAction(prev, form({ soapExpiresAt: "" }))

    expect(result.ok).toBe(true)
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ soapExpiresAt: null }))
  })

  it("varias fechas a la vez, y el mensaje lo dice en plural", async () => {
    const result = await updateVehicleExpiriesAction(prev, form({
      soapExpiresAt: "2027-12-31", technicalReviewExpiresAt: "2027-11-30", circulationPermitExpiresAt: "",
    }))

    expect(result).toMatchObject({ ok: true, message: "Vencimientos actualizados" })
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      soapExpiresAt: "2027-12-31", technicalReviewExpiresAt: "2027-11-30", circulationPermitExpiresAt: null,
    }))
  })

  it("si lo enviado es lo que ya había, no escribe, no audita y no revalida", async () => {
    const result = await updateVehicleExpiriesAction(prev, form({ soapExpiresAt: "2026-12-31", insuranceExpiresAt: "2027-01-15" }))

    expect(result).toMatchObject({ ok: true })
    expect(mockUpdateSet).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it("rechaza una fecha imposible con el nombre del documento y sin tocar la base", async () => {
    const result = await updateVehicleExpiriesAction(prev, form({ technicalReviewExpiresAt: "2026-02-31" }))

    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.technicalReviewExpiresAt?.[0]).toMatch(/revisión técnica/i)
    expect(mockFindVehicle).not.toHaveBeenCalled()
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it("sin el equipo en la solicitud no hay nada que actualizar", async () => {
    const data = new FormData()
    data.set("soapExpiresAt", "2027-12-31")

    const result = await updateVehicleExpiriesAction(prev, data)

    expect(result.ok).toBe(false)
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it("revalida el listado y la ficha del equipo", async () => {
    await updateVehicleExpiriesAction(prev, form({ technicalReviewExpiresAt: "2027-11-30" }))

    expect(mockRevalidatePath).toHaveBeenCalledWith("/flota")
    expect(mockRevalidatePath).toHaveBeenCalledWith("/flota/veh-1")
  })
})

describe("updateVehicleExpiriesAction · auditoría", () => {
  it("registra las cuatro columnas antes y después, dentro de la misma transacción", async () => {
    await updateVehicleExpiriesAction(prev, form({ technicalReviewExpiresAt: "2027-11-30", soapExpiresAt: "" }))

    expect(mockRecordAudit).toHaveBeenCalledTimes(1)
    const [entry, executor] = mockRecordAudit.mock.calls[0] as [Record<string, unknown>, unknown]
    expect(entry).toMatchObject({
      userId: "user-1",
      action: "update",
      entityType: "fuel_vehicle",
      entityId: "veh-1",
      entityCode: "KA-90",
      worksiteId: "ws-1",
      oldState: {
        soapExpiresAt: "2026-12-31",
        circulationPermitExpiresAt: "2027-03-31",
        technicalReviewExpiresAt: "2026-11-30",
        insuranceExpiresAt: "2027-01-15",
      },
      newState: {
        soapExpiresAt: null,
        circulationPermitExpiresAt: "2027-03-31",
        technicalReviewExpiresAt: "2027-11-30",
        insuranceExpiresAt: "2027-01-15",
      },
    })
    // El ejecutor es la transacción: si el UPDATE falla, la bitácora no queda con un cambio que no ocurrió.
    expect(executor).toBeDefined()
  })

  it("un equipo sin código se identifica por la patente", async () => {
    mockFindVehicle.mockResolvedValue({ ...vehicle, code: null })

    await updateVehicleExpiriesAction(prev, form({ technicalReviewExpiresAt: "2027-11-30" }))

    expect(mockRecordAudit.mock.calls[0]?.[0]).toMatchObject({ entityCode: "BPDH-67" })
  })
})
