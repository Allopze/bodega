import { describe, expect, it } from "vitest"
import { actionTypeFromText, specialtiesFromText, workOrderActionType } from "../action-type"

describe("actionTypeFromText", () => {
  it.each([
    ["CORRECTIVA", "correctiva"],
    ["ACCION CORRECTIVA", "correctiva"],
    ["Preventiva", "preventiva"],
    ["PREDICTIVA", "predictiva"],
    ["SIN CLASIFICAR (form. nuevo)", "sin_clasificar"],
    ["", "sin_clasificar"],
    [null, "sin_clasificar"],
    ["PREVENTIVA Y CORRECTIVA", "sin_clasificar"],
  ])("%s → %s", (text, type) => {
    expect(actionTypeFromText(text)).toBe(type)
  })
})

describe("workOrderActionType", () => {
  it("usa el tipo declarado", () => {
    expect(workOrderActionType({ actionType: "predictiva", repair: true, maintenance: false })).toBe("predictiva")
  })

  it("sin tipo, deriva sólo de casillas inequívocas", () => {
    expect(workOrderActionType({ actionType: null, repair: true, maintenance: false })).toBe("correctiva")
    expect(workOrderActionType({ actionType: null, repair: false, maintenance: true })).toBe("preventiva")
    expect(workOrderActionType({ actionType: null, repair: true, maintenance: true })).toBe("sin_clasificar")
  })
})

describe("specialtiesFromText", () => {
  it("reconoce y ordena", () => {
    expect(specialtiesFromText("SOLDADURA, MECANICO, ELECTRICO")).toEqual(["mecanica", "electrica", "soldadura"])
    expect(specialtiesFromText("HIDRAULICO")).toEqual(["hidraulica"])
  })

  it("nada reconocible es null", () => {
    expect(specialtiesFromText("")).toBeNull()
    expect(specialtiesFromText("OTRO")).toBeNull()
  })
})
