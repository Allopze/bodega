import { describe, expect, it } from "vitest"
import { revisionLandingHref } from "./landing"

describe("revisionLandingHref", () => {
  it("va a las anomalías cuando solo ellas tienen trabajo", () => {
    expect(revisionLandingHref({ flagged: 0, anomalies: 3 })).toBe("/combustibles/anomalias?estado=vigentes")
  })

  it("se queda en las cargas marcadas cuando hay cargas, con o sin anomalías", () => {
    expect(revisionLandingHref({ flagged: 2, anomalies: 0 })).toBe("/combustibles/control/revision")
    expect(revisionLandingHref({ flagged: 2, anomalies: 5 })).toBe("/combustibles/control/revision")
  })

  it("con las dos colas vacías entra por las cargas marcadas", () => {
    expect(revisionLandingHref({ flagged: 0, anomalies: 0 })).toBe("/combustibles/control/revision")
  })

  it("no afirma que una cola esté vacía cuando su conteo falló", () => {
    expect(revisionLandingHref({ flagged: null, anomalies: 4 })).toBe("/combustibles/control/revision")
    expect(revisionLandingHref({ flagged: 0, anomalies: null })).toBe("/combustibles/control/revision")
    expect(revisionLandingHref({ flagged: null, anomalies: null })).toBe("/combustibles/control/revision")
  })

  it("conserva la faena en cualquiera de los dos destinos", () => {
    expect(revisionLandingHref({ flagged: 0, anomalies: 1 }, "w-1")).toBe("/combustibles/anomalias?estado=vigentes&faena=w-1")
    expect(revisionLandingHref({ flagged: 1, anomalies: 0 }, "w-1")).toBe("/combustibles/control/revision?faena=w-1")
  })

  it("codifica la faena y descarta valores en blanco o repetidos", () => {
    expect(revisionLandingHref({ flagged: 1, anomalies: 0 }, " a&b ")).toBe("/combustibles/control/revision?faena=a%26b")
    expect(revisionLandingHref({ flagged: 1, anomalies: 0 }, "   ")).toBe("/combustibles/control/revision")
    expect(revisionLandingHref({ flagged: 1, anomalies: 0 }, ["w-1", "w-2"])).toBe("/combustibles/control/revision?faena=w-1")
    expect(revisionLandingHref({ flagged: 1, anomalies: 0 }, undefined)).toBe("/combustibles/control/revision")
  })
})
