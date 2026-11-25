import { describe, expect, it } from "vitest"
import { maintenanceTypeBlock, maintenanceUnitOfMeter, type PadronMaintenance } from "./padron-identity"

const base: PadronMaintenance = { brandId: "b1", noPlate: false, unit: "km", unitFixedBy: null, canChangeProfile: true }
const CAMION = { defaultMeterType: "odometer", performanceFamily: "camiones" }
const TRACTO = { defaultMeterType: "odometer", performanceFamily: "camiones" }
/** Tipos que no son de la familia camiones: su unidad es la de su medidor, en cualquier faena. */
const ODOMETRO = { defaultMeterType: "odometer", performanceFamily: null }
const EXCAVADORA = { defaultMeterType: "hour_meter", performanceFamily: null }
const FN_ARA = "FN-ARA"
const BIODIVERSA = "BIODIVERSA"

describe("qué tipos ofrece el padrón a un equipo de Mantención (paso 4b)", () => {
  it("la unidad sale del medidor del tipo", () => {
    expect(maintenanceUnitOfMeter("odometer")).toBe("km")
    expect(maintenanceUnitOfMeter("hour_meter")).toBe("h")
    expect(maintenanceUnitOfMeter("none")).toBeNull()
  })

  it("un tipo sin medidor nunca; uno de otra unidad sólo si nada la fija", () => {
    expect(maintenanceTypeBlock(base, { defaultMeterType: "none", performanceFamily: null }, FN_ARA)).toBe("no se mide en km ni en horas")
    expect(maintenanceTypeBlock(base, EXCAVADORA, FN_ARA)).toBeNull()
    expect(maintenanceTypeBlock({ ...base, unitFixedBy: { kind: "registros" } }, EXCAVADORA, FN_ARA)).toBe("se mide en horas")
    expect(maintenanceTypeBlock({ ...base, unit: "h", unitFixedBy: { kind: "pauta", scheduleName: "Maquinaria" } }, ODOMETRO, FN_ARA)).toBe("se mide en km")
    expect(maintenanceTypeBlock({ ...base, unitFixedBy: { kind: "registros" } }, ODOMETRO, FN_ARA)).toBeNull()
  })

  it("un camión en horas fuera de Biodiversa: pasar a otro tipo de camión de odómetro no se bloquea", () => {
    const horas: PadronMaintenance = { ...base, unit: "h", unitFixedBy: { kind: "registros" } }
    // «Camión» → «Tractocamión» (ambos de odómetro y de la familia camiones): en Arauco siguen en horas.
    expect(maintenanceTypeBlock(horas, TRACTO, FN_ARA)).toBeNull()
    // En Biodiversa el mismo tipo mide en km: un equipo en horas no puede pasar a él con registros.
    expect(maintenanceTypeBlock(horas, TRACTO, BIODIVERSA)).toBe("se mide en km")
  })

  it("un camión en km de Biodiversa con pauta sólo pasa a un tipo que siga en km en su faena", () => {
    const km: PadronMaintenance = { ...base, unit: "km", unitFixedBy: { kind: "pauta", scheduleName: "Camiones y tractos" } }
    expect(maintenanceTypeBlock(km, CAMION, BIODIVERSA)).toBeNull()
    // Fuera de Biodiversa el mismo camión mide en horas: con la pauta en km, ese tipo ya no es posible.
    expect(maintenanceTypeBlock(km, CAMION, FN_ARA)).toBe("se mide en horas")
  })

  it("sin registros ni pauta no bloquea ningún tipo medido", () => {
    expect(maintenanceTypeBlock({ ...base, unit: "h" }, CAMION, FN_ARA)).toBeNull()
    expect(maintenanceTypeBlock({ ...base, unit: "h" }, EXCAVADORA, FN_ARA)).toBeNull()
  })

  it("sin familia, o para un camión sin código de faena, no bloquea: el servidor decide", () => {
    const horas: PadronMaintenance = { ...base, unit: "h", unitFixedBy: { kind: "registros" } }
    // Sin `performanceFamily` en el catálogo no se sabe la unidad del tipo: no se ofrece un bloqueo que podría ser falso.
    expect(maintenanceTypeBlock(horas, { defaultMeterType: "odometer" }, FN_ARA)).toBeNull()
    expect(maintenanceTypeBlock(horas, TRACTO, undefined)).toBeNull()
  })
})
