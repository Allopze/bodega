import { describe, expect, it } from "vitest"
import { licenseRenewal } from "@/lib/services/ti/license-renewal"

describe("licenseRenewal (TIUX-41)", () => {
  const today = "2026-10-05"

  it("sin fecha o con la licencia inactiva no pide atención", () => {
    expect(licenseRenewal(null, true, today)).toMatchObject({ kind: "none", urgent: false })
    expect(licenseRenewal("2026-10-06", false, today)).toMatchObject({ kind: "none", urgent: false })
  })

  it("hasta 14 días es próxima y lo dice con texto", () => {
    expect(licenseRenewal("2026-10-19", true, today)).toMatchObject({ kind: "soon", label: "Renueva en 14 días", variant: "warning", urgent: true })
    expect(licenseRenewal("2026-10-06", true, today).label).toBe("Renueva mañana")
    expect(licenseRenewal("2026-10-05", true, today).label).toBe("Renueva hoy")
  })

  it("a 15 días o más no es urgente", () => {
    expect(licenseRenewal("2026-10-20", true, today)).toMatchObject({ kind: "later", urgent: false })
  })

  it("una fecha pasada es renovación vencida", () => {
    expect(licenseRenewal("2026-10-04", true, today)).toMatchObject({ kind: "overdue", label: "Renovación vencida", variant: "danger", urgent: true })
  })
})
