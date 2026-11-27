import { describe, expect, it } from "vitest"
import { maintenanceTypeBlock, maintenanceUnitOfMeter, type PadronMaintenance } from "./padron-identity"

const base: PadronMaintenance = { brandId: "b1", noPlate: false, unit: "km", unitFixedBy: null, canChangeProfile: true }
const ODOMETRO = { defaultMeterType: "odometer" }
const EXCAVADORA = { defaultMeterType: "hour_meter" }

describe("qué tipos ofrece el padrón a un equipo de Mantención (paso 4b)", () => {
  it("la unidad sale del medidor del tipo", () => {
    expect(maintenanceUnitOfMeter("odometer")).toBe("km")
    expect(maintenanceUnitOfMeter("hour_meter")).toBe("h")
    expect(maintenanceUnitOfMeter("none")).toBeNull()
  })

  it("un tipo sin medidor nunca; uno de otra unidad sólo si nada la fija", () => {
    expect(maintenanceTypeBlock(base, { defaultMeterType: "none" })).toBe("no se mide en km ni en horas")
    expect(maintenanceTypeBlock(base, EXCAVADORA)).toBeNull()
    expect(maintenanceTypeBlock({ ...base, unitFixedBy: { kind: "registros" } }, EXCAVADORA)).toBe("se mide en horas")
    expect(maintenanceTypeBlock({ ...base, unit: "h", unitFixedBy: { kind: "pauta", scheduleName: "Maquinaria" } }, ODOMETRO)).toBe("se mide en km")
    expect(maintenanceTypeBlock({ ...base, unitFixedBy: { kind: "registros" } }, ODOMETRO)).toBeNull()
  })

  it("un equipo dado de alta en otra unidad que la de su tipo no se bloquea al cambiar a otro tipo que mide como el actual", () => {
    // Un camión de odómetro dado de alta en horas, con registros: «Camión» → «Tractocamión» (ambos de odómetro) no mueve su unidad.
    const horas: PadronMaintenance = { ...base, unit: "h", typeUnit: "km", unitFixedBy: { kind: "registros" } }
    expect(maintenanceTypeBlock(horas, ODOMETRO)).toBeNull()
    // Un tipo que mide en horas coincide con la unidad del equipo: tampoco se bloquea.
    expect(maintenanceTypeBlock(horas, EXCAVADORA)).toBeNull()
  })

  it("un equipo en km con pauta sólo pasa a un tipo de odómetro; el de horas queda bloqueado", () => {
    const km: PadronMaintenance = { ...base, unit: "km", typeUnit: "km", unitFixedBy: { kind: "pauta", scheduleName: "Camiones y tractos" } }
    expect(maintenanceTypeBlock(km, ODOMETRO)).toBeNull()
    expect(maintenanceTypeBlock(km, EXCAVADORA)).toBe("se mide en horas")
  })

  it("sin registros ni pauta no bloquea ningún tipo medido", () => {
    expect(maintenanceTypeBlock({ ...base, unit: "h" }, ODOMETRO)).toBeNull()
    expect(maintenanceTypeBlock({ ...base, unit: "h" }, EXCAVADORA)).toBeNull()
  })

  it("sin la unidad del tipo actual (quien arma el dato no la trae) se compara sólo con la del equipo", () => {
    const horas: PadronMaintenance = { ...base, unit: "h", unitFixedBy: { kind: "registros" } }
    expect(maintenanceTypeBlock(horas, ODOMETRO)).toBe("se mide en km")
    expect(maintenanceTypeBlock(horas, EXCAVADORA)).toBeNull()
  })
})
