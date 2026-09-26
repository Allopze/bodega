// @vitest-environment jsdom

/**
 * PREV-I10: desde b5ff6c1f cerrar una campaña no acredita el PDTP —las N°85 a
 * N°89 se acreditan con su ocurrencia CAM-* de Capacitación—, pero el diálogo
 * de cierre seguía prometiendo "Confirmar y Acreditar PDTP". Quien lo usaba
 * daba la actividad por cumplida y no iba a Capacitación.
 */
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/prevencion/campanas",
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("./actions", () => ({ closeCampaignAction: vi.fn(), setCampaignPdtpActivitiesAction: vi.fn() }))

const { CampanasClient } = await import("./campanas-client")
const { ShellHeaderProvider } = await import("@/components/layout/header-context")

const pending = {
  id: "camp-1", worksiteId: "ws-1", worksiteName: "Faena Norte", code: "CAMP-001",
  title: "Puntos ciegos", description: null, status: "pending", pdtpActivityNumbers: [88],
  evidenceUrl: null, heldOn: null, completedAt: null, completedByUserId: null,
  createdByUserId: "user-1", createdAt: "2026-05-01T12:00:00.000Z", updatedAt: "2026-05-01T12:00:00.000Z",
}

describe("CampanasClient — cierre de una campaña legado", () => {
  it("no promete una acreditación PDTP que el cierre ya no hace", () => {
    render(<ShellHeaderProvider><CampanasClient initialCampaigns={[pending]} canManage catalogActivities={[]} catalogBindings={{}} /></ShellHeaderProvider>)

    fireEvent.click(screen.getByRole("button", { name: "Marcar como hecha" }))
    const dialog = screen.getByRole("dialog")

    expect(dialog).not.toHaveTextContent(/acredita(r|ción)/i)
    expect(dialog).toHaveTextContent(/no acredita el PDTP/i)
    expect(dialog).toHaveTextContent(/Capacitación/)
    expect(screen.getByRole("button", { name: "Confirmar cierre" })).toBeInTheDocument()
  })
})
