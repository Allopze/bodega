import { describe, expect, it } from "vitest"
import {
  buildVehicleIdentityIndex,
  matchVehicleByIdentity,
  normalizeGpsKey,
  plateCandidatesFromText,
} from "../identity"

const vehicles = [
  { id: "v1", plate: "ABCD-12", code: "KA-63" },
  { id: "v2", plate: "AB-1234", code: null },
  { id: "v3", plate: "AB1234", code: null },
]
const index = buildVehicleIdentityIndex(vehicles)

describe("identidad GPS", () => {
  it("normaliza tildes, separadores y mayúsculas", () => {
    expect(normalizeGpsKey("  Camión N° 01 ")).toBe("CAMIONN01")
  })

  it("encuentra una patente chilena embebida en un nombre libre", () => {
    expect(plateCandidatesFromText("CAMION ABCD12 · turno 2")).toEqual(["ABCD12"])
    expect(plateCandidatesFromText("EXCAVADORA 01")).toEqual([])
  })

  it("resuelve por patente antes que por código", () => {
    expect(matchVehicleByIdentity({ plate: "ABCD12", code: "KA-63" }, index)).toMatchObject({
      kind: "matched",
      vehicle: { id: "v1" },
      reason: "plate",
    })
  })

  it("resuelve por código cuando no hay patente", () => {
    expect(matchVehicleByIdentity({ code: "ka 63" }, index)).toMatchObject({
      kind: "matched",
      vehicle: { id: "v1" },
      reason: "code",
    })
  })

  it("no elige cuando dos vehículos normalizan a la misma patente", () => {
    expect(matchVehicleByIdentity({ plate: "AB1234" }, index)).toMatchObject({
      kind: "ambiguous",
      candidates: [{ id: "v2" }, { id: "v3" }],
    })
  })

  it("no inventa un vehículo cuando el nombre no calza", () => {
    expect(matchVehicleByIdentity({ name: "EXCAVADORA 01" }, index)).toEqual({ kind: "unmatched" })
  })
})
