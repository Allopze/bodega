import { describe, expect, it } from "vitest"
import { maintenanceTypeBlock, maintenanceUnitOfMeter, type PadronMaintenance } from "./padron-identity"

const base: PadronMaintenance = { brandId: "b1", noPlate: false, unit: "km", unitFixedBy: null, canChangeProfile: true }

describe("qué tipos ofrece el padrón a un equipo de Mantención (paso 4b)", () => {
  it("la unidad sale del medidor del tipo", () => {
    expect(maintenanceUnitOfMeter("odometer")).toBe("km")
    expect(maintenanceUnitOfMeter("hour_meter")).toBe("h")
    expect(maintenanceUnitOfMeter("none")).toBeNull()
  })

  it("un tipo sin medidor nunca; uno de otra unidad sólo si nada la fija", () => {
    expect(maintenanceTypeBlock(base, "none")).toBe("no se mide en km ni en horas")
    expect(maintenanceTypeBlock(base, "hour_meter")).toBeNull()
    expect(maintenanceTypeBlock({ ...base, unitFixedBy: { kind: "registros" } }, "hour_meter")).toBe("se mide en horas")
    expect(maintenanceTypeBlock({ ...base, unit: "h", unitFixedBy: { kind: "pauta", scheduleName: "Maquinaria" } }, "odometer")).toBe("se mide en km")
    expect(maintenanceTypeBlock({ ...base, unitFixedBy: { kind: "registros" } }, "odometer")).toBeNull()
  })
})
