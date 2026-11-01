import { describe, expect, it } from "vitest"
import {
  ARAMCO_SOURCES,
  AUTOMATED_SOURCES,
  COPEC_TCT_SOURCES,
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

})
