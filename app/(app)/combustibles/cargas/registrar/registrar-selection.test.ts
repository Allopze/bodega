import { describe, expect, it } from "vitest"
import { resolveRegistrarSelection } from "./registrar-selection"

const norte = { id: "ws-n", name: "Norte" }
const sur = { id: "ws-s", name: "Sur" }
const surtidor = { id: "p-1", name: "Surtidor", worksiteId: "ws-n" }
const bidon = { id: "p-2", name: "Bidón", worksiteId: "ws-n" }

describe("resolveRegistrarSelection", () => {
  it("con una sola faena operable entre varias, la deja elegida y no ofrece la que no tiene puntos", () => {
    const result = resolveRegistrarSelection({ worksites: [norte, sur], points: [surtidor], requestedWorksiteId: "", requestedPointId: "" })
    expect(result).toEqual({ worksites: [norte], worksiteId: "ws-n", pointId: "p-1" })
  })

  it("con varios puntos en la faena, el punto queda por elegir", () => {
    expect(resolveRegistrarSelection({ worksites: [norte], points: [surtidor, bidon], requestedWorksiteId: "", requestedPointId: "" }))
      .toMatchObject({ worksiteId: "ws-n", pointId: "" })
  })

  it("respeta la faena y el punto de la URL sólo si son operables", () => {
    const points = [surtidor, bidon, { id: "p-3", name: "Camión", worksiteId: "ws-s" }]
    expect(resolveRegistrarSelection({ worksites: [norte, sur], points, requestedWorksiteId: "ws-s", requestedPointId: "p-3" }))
      .toMatchObject({ worksiteId: "ws-s", pointId: "p-3" })
    // Un punto de otra faena no se acepta; una faena fuera de las opciones tampoco.
    expect(resolveRegistrarSelection({ worksites: [norte, sur], points, requestedWorksiteId: "ws-n", requestedPointId: "p-3" }))
      .toMatchObject({ worksiteId: "ws-n", pointId: "" })
    expect(resolveRegistrarSelection({ worksites: [norte, sur], points, requestedWorksiteId: "ws-x", requestedPointId: "" }))
      .toMatchObject({ worksiteId: "", pointId: "" })
  })

  it("si no se pudieron leer los puntos, ofrece todas las faenas en vez de ninguna", () => {
    expect(resolveRegistrarSelection({ worksites: [norte, sur], points: [], requestedWorksiteId: "", requestedPointId: "", pointsKnown: false }))
      .toEqual({ worksites: [norte, sur], worksiteId: "", pointId: "" })
  })
})
