/**
 * CO-007: el guard de módulo de `requirePermission` estaba condicionado a que
 * existiera la cabecera `x-chome-pathname`. Como el matcher del proxy excluye
 * cualquier ruta con punto, una Server Action POSTeada a `/flota/a.b` no la
 * recibía y la puerta quedaba completamente desactivada — no denegaba, ni
 * siquiera consultaba. El permiso identifica su módulo por sí solo: el guard no
 * puede depender de la cabecera.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import type { Session } from "next-auth"

const mockAuth = vi.hoisted(() => vi.fn())
const mockAssertPermissionModuleEnabled = vi.hoisted(() => vi.fn())
const mockHeaders = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("next/headers", () => ({ headers: mockHeaders }))
vi.mock("@/lib/services/module-toggles", async () => {
  const actual = await vi.importActual<typeof import("@/lib/services/module-toggles")>("@/lib/services/module-toggles")
  return { ...actual, assertPermissionModuleEnabled: mockAssertPermissionModuleEnabled }
})

const { requirePermission, guardPermission } = await import("@/lib/auth/can")
const { ModuleDisabledError } = await import("@/lib/services/module-toggles")

const session = {
  user: { id: "u-1", permissions: ["flota:manage_documents"], worksiteIds: [], isGlobal: true },
} as unknown as Session

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(session)
  mockAssertPermissionModuleEnabled.mockResolvedValue(undefined)
})

describe("guard de módulo sin cabecera de ruta", () => {
  it("consulta el toggle aunque `headers()` falle (invocación fuera de request)", async () => {
    mockHeaders.mockRejectedValue(new Error("fuera de request scope"))

    await requirePermission("flota:manage_documents")

    expect(mockAssertPermissionModuleEnabled).toHaveBeenCalledWith("flota:manage_documents", undefined, undefined)
  })

  it("consulta el toggle aunque la cabecera no venga (ruta fuera del matcher)", async () => {
    mockHeaders.mockResolvedValue({ get: () => null })

    await requirePermission("flota:manage_documents")

    expect(mockAssertPermissionModuleEnabled).toHaveBeenCalledWith("flota:manage_documents", undefined, undefined)
  })

  it("con el módulo apagado, la acción responde módulo inactivo y no permiso faltante", async () => {
    mockHeaders.mockResolvedValue({ get: () => null })
    mockAssertPermissionModuleEnabled.mockRejectedValue(new ModuleDisabledError("flota"))

    const result = await guardPermission("flota:manage_documents")

    expect(result.session).toBeNull()
    expect(result.error?.message).toMatch(/inactivo/i)
  })
})
