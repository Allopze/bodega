import { describe, expect, it } from "vitest"
import {
  buildVehicleIdentityIndex,
  buildVehicleResolverByPlate,
  codeCandidatesFromText,
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

// Nombres reales de la cuenta Wialon (2026-11-12) contra códigos del catálogo.
describe("código y patente embebidos en el nombre", () => {
  const fleet = [
    { id: "cr52", plate: "RKHR-28", code: "CR-52" },
    { id: "gr11", plate: "RKHR-21", code: "GR-11" },
    { id: "to37", plate: "TO-37", code: "TO-37" },
    { id: "zv", plate: "ZV-6852", code: null },
  ]
  const fleetIndex = buildVehicleIdentityIndex(fleet)

  it("extrae sólo palabras con letras y dígitos", () => {
    expect(codeCandidatesFromText("CARGADOR FRONTAL CR-52")).toEqual(["CR52"])
    expect(codeCandidatesFromText("JD 6125 E (Recart)")).toEqual([])
    expect(codeCandidatesFromText("TO37 D6R")).toEqual(["TO37", "D6R"])
  })

  it("vincula por código interno dentro del nombre", () => {
    expect(matchVehicleByIdentity({ name: "CARGADOR FRONTAL CR-52" }, fleetIndex)).toMatchObject({ kind: "matched", vehicle: { id: "cr52" }, reason: "text" })
    expect(matchVehicleByIdentity({ name: "EXCAVADORA GR-11" }, fleetIndex)).toMatchObject({ kind: "matched", vehicle: { id: "gr11" } })
    expect(matchVehicleByIdentity({ name: "TO37 D6R" }, fleetIndex)).toMatchObject({ kind: "matched", vehicle: { id: "to37" } })
  })

  it("reconoce patentes con guion o pegadas dentro del nombre", () => {
    expect(matchVehicleByIdentity({ name: "l200- ZV6852" }, fleetIndex)).toMatchObject({ kind: "matched", vehicle: { id: "zv" } })
    expect(matchVehicleByIdentity({ name: "Camión ZV-6852" }, fleetIndex)).toMatchObject({ kind: "matched", vehicle: { id: "zv" } })
  })

  it("un código que no existe en el catálogo queda pendiente", () => {
    expect(matchVehicleByIdentity({ name: "EXCAVADORA CAT CR-10" }, fleetIndex)).toEqual({ kind: "unmatched" })
  })

  it("dos códigos de vehículos distintos en el mismo nombre no se eligen", () => {
    expect(matchVehicleByIdentity({ name: "CR-52 / GR-11" }, fleetIndex)).toMatchObject({ kind: "ambiguous" })
  })
})

describe("buildVehicleResolverByPlate", () => {
  it("resuelve la patente exacta y, si es única, la normalizada", () => {
    const resolve = buildVehicleResolverByPlate([
      { id: "a", plate: "CBJY-18", meterType: "odometer" },
      { id: "b", plate: "XX-4243", meterType: "hour_meter" },
      { id: "c", plate: "XX4243", meterType: "hour_meter" },
    ])
    expect(resolve("CBJY-18")).toEqual({ id: "a", meterType: "odometer" })
    expect(resolve("CBJY18")).toEqual({ id: "a", meterType: "odometer" })
    expect(resolve("XX-4243")).toEqual({ id: "b", meterType: "hour_meter" })
    // Dos patentes que normalizan igual: la normalizada no elige.
    expect(resolve("XX 4243")).toBeUndefined()
  })
})
