import { describe, expect, it } from "vitest"
import { canonicalEquipmentCode, equipmentCodeKey, matchVehicle, plateKey } from "../equipment-identity"

describe("equipmentCodeKey", () => {
  it.each([
    ["Ka-128", "KA128"],
    ["TO.38", "TO38"],
    ["KRR-010", "KRR10"],
    ["krr 10", "KRR10"],
    ["KCH-133", "KCH133"],
    ["H-4", "H4"],
    ["CR-30", "CR30"],
    ["  ", ""],
    [null, ""],
  ])("%s → %s", (raw, key) => {
    expect(equipmentCodeKey(raw)).toBe(key)
  })

  it("no confunde un cero que no está a la izquierda", () => {
    expect(equipmentCodeKey("GR-10")).toBe("GR10")
    expect(equipmentCodeKey("GR-100")).not.toBe(equipmentCodeKey("GR-10"))
  })
})

describe("plateKey", () => {
  it.each([
    ["SJFC66", "SJFC66"],
    ["SR-CJ-44", "SRCJ44"],
    ["JN-67-70", "JN6770"],
    ["zy-3970", "ZY3970"],
  ])("%s → %s", (raw, key) => {
    expect(plateKey(raw)).toBe(key)
  })

  it("conserva los ceros de una patente", () => {
    expect(plateKey("PW-TY-04")).toBe("PWTY04")
  })
})

describe("canonicalEquipmentCode", () => {
  it.each([
    ["ka 128", "KA-128"],
    ["TO.38", "TO-38"],
    ["KRR-010", "KRR-010"],
    ["kch133", "KCH-133"],
  ])("%s → %s", (raw, code) => {
    expect(canonicalEquipmentCode(raw)).toBe(code)
  })

  it.each(["DEIBIS", "TALLER", "6633/90744", "", "OPCIÓN 29 B"])("no adivina «%s»", (raw) => {
    expect(canonicalEquipmentCode(raw)).toBeNull()
  })
})

describe("matchVehicle", () => {
  const vehicles = [
    { id: "v1", code: "KCH-133", plate: "SRCJ-42" },
    { id: "v2", code: "KCH-135", plate: "SRCJ-39" },
    { id: "v3", code: null, plate: "JG-1255" },
    { id: "v4", code: "KRR-10", plate: "PWTY-84" },
  ]

  it("vincula por código con variantes de escritura", () => {
    expect(matchVehicle({ code: "krr-010" }, vehicles)).toEqual({ state: "linked", vehicleId: "v4" })
  })

  it("vincula por patente cuando el equipo no tiene código", () => {
    expect(matchVehicle({ plate: "JG1255" }, vehicles)).toEqual({ state: "linked", vehicleId: "v3" })
  })

  it("código y patente de equipos distintos es conflicto, no elige", () => {
    expect(matchVehicle({ code: "KCH-133", plate: "SRCJ-39" }, vehicles)).toMatchObject({ state: "conflict", vehicleId: null })
  })

  it("lo desconocido queda sin vincular", () => {
    expect(matchVehicle({ code: "H-13", plate: "LCCY-14" }, vehicles)).toEqual({ state: "unmatched", vehicleId: null })
    expect(matchVehicle({}, vehicles)).toEqual({ state: "unmatched", vehicleId: null })
  })

  it("un código repetido en la flota es conflicto", () => {
    const repeated = [...vehicles, { id: "v5", code: "KCH 133", plate: "XXXX-11" }]
    expect(matchVehicle({ code: "KCH-133" }, repeated)).toMatchObject({ state: "conflict" })
  })
})
