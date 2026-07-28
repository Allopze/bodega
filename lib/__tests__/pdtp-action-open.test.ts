import { describe, expect, it } from "vitest"
import { isPdtpActionOpen, PDTP_ESTADOS_CERRADOS } from "@/lib/services/pdtp/checklist-domain"

/**
 * Guarda de regresión del KPI "Acciones Pendientes" del tablero PDTP, que
 * filtraba por `"verificada"` — un valor que no existe en el enum de
 * `pdtpActionPlan.estado` (es `verificado`, y "verificada" es vocabulario de PPA
 * y evaluaciones). El filtro no excluía nada y el tile contaba el 100 % de las
 * acciones del programa, junto a un contador de vencidas que sí era correcto.
 */
describe("isPdtpActionOpen", () => {
  it("trata como cerrados exactamente los estados del dominio", () => {
    expect([...PDTP_ESTADOS_CERRADOS].sort()).toEqual(["cancelado", "completado", "verificado"])

    expect(isPdtpActionOpen("completado")).toBe(false)
    expect(isPdtpActionOpen("verificado")).toBe(false)
    expect(isPdtpActionOpen("cancelado")).toBe(false)
  })

  it("trata como abiertos los estados en curso", () => {
    expect(isPdtpActionOpen("pendiente")).toBe(true)
    expect(isPdtpActionOpen("en_proceso")).toBe(true)
  })

  it("no reconoce el vocabulario de PPA como cierre", () => {
    // Si alguien vuelve a comparar contra estas variantes, el conteo se rompe en
    // silencio: no coinciden con ningún estado real y todo queda "abierto".
    expect(PDTP_ESTADOS_CERRADOS.has("verificada")).toBe(false)
    expect(PDTP_ESTADOS_CERRADOS.has("cerrada")).toBe(false)
  })

  it("cuenta las acciones abiertas de una cartera mixta", () => {
    const estados = ["pendiente", "en_proceso", "completado", "verificado", "cancelado", "pendiente"]
    expect(estados.filter(isPdtpActionOpen)).toEqual(["pendiente", "en_proceso", "pendiente"])
  })
})
