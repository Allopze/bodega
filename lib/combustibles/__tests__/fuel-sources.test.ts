import { describe, expect, it } from "vitest"
import {
  ARAMCO_SOURCES,
  AUTOMATED_SOURCES,
  COPEC_TCT_SOURCES,
  aramcoSourceForProduct,
  copecTctSource,
} from "../fuel-sources"

describe("fuel sources", () => {
  it("treats every provider's own sources as automated", () => {
    for (const source of [...COPEC_TCT_SOURCES, ...ARAMCO_SOURCES]) {
      expect(AUTOMATED_SOURCES).toContain(source)
    }
  })

  it("derives Copec's source from the same list the guard checks", () => {
    // `copec-sync` construía la etiqueta con un template aparte: editar sólo uno
    // de los dos desalineaba el dedup (fuente exacta) del guard (contra la lista).
    for (const product of ["diesel", "bluemax"] as const) {
      expect(COPEC_TCT_SOURCES).toContain(copecTctSource(product))
      expect(AUTOMATED_SOURCES).toContain(copecTctSource(product))
    }
    expect(copecTctSource("diesel")).not.toBe(copecTctSource("bluemax"))
  })

  it("classifies the products the portal actually reports", () => {
    // "Aramco ProForce Diesel B" es el único producto que la cuenta transó, y
    // no aparece en `products/main`: de ahí que se clasifique por nombre.
    expect(aramcoSourceForProduct("Aramco ProForce Diesel B")).toBe("Aramco Fleet Diesel")
    expect(aramcoSourceForProduct("Aramco ProForce Diesel A")).toBe("Aramco Fleet Diesel")
    expect(aramcoSourceForProduct("ADBLUE-FLUA")).toBe("Aramco Fleet AdBlue")
  })

  it("routes fuels the account has enabled but never used", () => {
    // Cada uno a SU fuente: `fuel_consumption_records` no tiene columna de
    // producto, así que compartir el cajón "Otros" habría mezclado gasolina y
    // kerosene en un mismo agregado mensual.
    expect(aramcoSourceForProduct("Aramco Gasolina 93")).toBe("Aramco Fleet Gasolina")
    expect(aramcoSourceForProduct("Kerosene")).toBe("Aramco Fleet Kerosene")
    // "Otros" queda de red para lo que se acepte a futuro sin fuente propia.
    expect(aramcoSourceForProduct("Producto nuevo del portal")).toBe("Aramco Fleet Otros")
  })

  it("never invents a source outside the declared list", () => {
    // Invariante que sostiene el guard de import ajeno: si esta función devuelve
    // una etiqueta que no está en ARAMCO_SOURCES, los lotes con esa fuente
    // pasarían por "carga manual" y silenciarían la sincronización de Copec.
    const products = [
      "Aramco ProForce Diesel B", "ADBLUE-FLUA", "Aramco Gasolina 93", "Kerosene",
      "", "   ", "Diésel con acento", "producto nuevo que nadie previó", "BLUEMAX",
    ]
    for (const product of products) {
      expect(ARAMCO_SOURCES).toContain(aramcoSourceForProduct(product))
    }
    expect(ARAMCO_SOURCES).toContain(aramcoSourceForProduct(null))
    expect(ARAMCO_SOURCES).toContain(aramcoSourceForProduct(undefined))
  })
})
