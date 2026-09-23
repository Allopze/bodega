import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"

const mockAuth = vi.hoisted(() => vi.fn())
const mockCloseCampaign = vi.hoisted(() => vi.fn())
const mockSetCampaignPdtpActivities = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
// El guard de módulos consulta system_settings en cada verificación de ruta;
// sin este mock, requireAuth golpea un @/db real inexistente en este test.
vi.mock("@/lib/services/module-toggles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/module-toggles")>()),
  assertPermissionModuleEnabled: vi.fn(async () => {}),
  assertRouteModuleEnabled: vi.fn(async () => {}),
}))
// Mockea sólo las funciones de servicio que golpean la base; deja pasar
// CampaignDomainError real, que `campaignFailure` usa con `instanceof`.
vi.mock("@/lib/services/prevention-campaigns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/prevention-campaigns")>()
  return {
    ...actual,
    closeCampaign: mockCloseCampaign,
    setCampaignPdtpActivities: mockSetCampaignPdtpActivities,
  }
})

function session(permissions: string[]): Session {
  return {
    user: {
      id: "u1", name: "Usuario", email: "u@test.local", permissions,
      roles: ["prevencionista"], worksiteIds: [], isGlobal: true,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as unknown as Session
}

beforeEach(() => {
  vi.resetAllMocks()
  mockCloseCampaign.mockResolvedValue({
    campaign: { id: "camp-1", status: "done" },
    pdtpAccredited: true,
    pdtpPending: false,
  })
})

describe("createCampaignAction (Task 13 — /prevencion/campanas deja de aceptar altas nuevas)", () => {
  it("rechaza siempre, sin llegar al servicio, y redirige a Capacitación en el mensaje", async () => {
    mockAuth.mockResolvedValue(session(["prevention:campaign:view", "prevention:campaign:manage"]))
    const { createCampaignAction } = await import("@/app/(app)/prevencion/campanas/actions")

    const result = await createCampaignAction({
      worksiteId: "ws-1", title: "Campaña nueva intentada", pdtpActivityNumbers: [85],
    })

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/prevencion\/capacitacion/i)
  })

  it("sigue exigiendo autenticación antes de responder", async () => {
    mockAuth.mockResolvedValue(null)
    const { createCampaignAction } = await import("@/app/(app)/prevencion/campanas/actions")

    const result = await createCampaignAction({ worksiteId: "ws-1", title: "x" })
    expect(result.ok).toBe(false)
  })
})

describe("closeCampaignAction — regresión: `heldOn` se perdía antes de llegar al servicio", () => {
  /**
   * El schema de este action no declaraba `heldOn`: zod lo descartaba en
   * silencio y `closeCampaign` (que sí lo exige) rechazaba con "Indica la
   * fecha en que se hizo la campaña" para CUALQUIER intento de "Marcar como
   * hecha" desde la UI. Task 13 depende de que esta acción siga funcionando
   * para las campañas `pending` que ya existían antes de retirar la alta.
   */
  it("pasa heldOn al servicio en vez de descartarlo", async () => {
    mockAuth.mockResolvedValue(session(["prevention:campaign:view", "prevention:campaign:manage"]))
    const { closeCampaignAction } = await import("@/app/(app)/prevencion/campanas/actions")

    const result = await closeCampaignAction({
      campaignId: "camp-1", heldOn: "2026-03-12", evidenceUrl: "https://drive.chome.cl/acta-campana",
    })

    expect(result.ok).toBe(true)
    expect(mockCloseCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "camp-1", heldOn: "2026-03-12", evidenceUrl: "https://drive.chome.cl/acta-campana" }),
      expect.anything(),
    )
  })

  it("rechaza sin heldOn en vez de dejarlo pasar en blanco", async () => {
    mockAuth.mockResolvedValue(session(["prevention:campaign:view", "prevention:campaign:manage"]))
    const { closeCampaignAction } = await import("@/app/(app)/prevencion/campanas/actions")

    const result = await closeCampaignAction({
      campaignId: "camp-1", evidenceUrl: "https://drive.chome.cl/acta-campana",
    })

    expect(result.ok).toBe(false)
    expect(mockCloseCampaign).not.toHaveBeenCalled()
  })
})
