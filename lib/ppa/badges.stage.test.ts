/**
 * PPAI-001 (auditoría 2026-09-14), patrón P7: aceptar la verificación de un PPA
 * **no cambia el estado** —sigue en `pendiente_verificacion`— y el hito lo marca
 * `verifiedAt`. Con una sola etiqueta, dos colas de trabajo con permisos
 * distintos (`ppa:verify` y `ppa:authorize_restart`) se veían idénticas.
 */
import { describe, expect, it } from "vitest"
import { estadoPpaLabel, ppaStageCta, ppaStageLabel } from "./badges"

const AYER = "2026-09-13T12:00:00.000Z"

describe("ppaStageLabel", () => {
  it("antes de verificar dice lo mismo de siempre", () => {
    expect(ppaStageLabel("pendiente_verificacion", null)).toBe("Pendiente de verificación")
    expect(ppaStageLabel("pendiente_verificacion", undefined)).toBe("Pendiente de verificación")
  })

  it("después de verificar dice que lo que falta es autorizar", () => {
    expect(ppaStageLabel("pendiente_verificacion", AYER))
      .toBe("Verificado · pendiente de autorización")
  })

  it("los demás estados no cambian de nombre", () => {
    for (const estado of ["detenido", "en_correccion", "autorizado", "cerrado", "rechazado"]) {
      expect(ppaStageLabel(estado, AYER)).toBe(estadoPpaLabel(estado))
      expect(ppaStageLabel(estado, null)).toBe(estadoPpaLabel(estado))
    }
  })
})

describe("ppaStageCta", () => {
  it("el atajo lleva al trabajo que toca, no a uno genérico", () => {
    expect(ppaStageCta("pendiente_verificacion", null)).toBe("Verificar corrección")
    expect(ppaStageCta("pendiente_verificacion", AYER)).toBe("Autorizar reinicio")
    expect(ppaStageCta("detenido", null)).toBe("Revisar caso PPA")
    expect(ppaStageCta("en_correccion", AYER)).toBe("Revisar caso PPA")
  })
})
