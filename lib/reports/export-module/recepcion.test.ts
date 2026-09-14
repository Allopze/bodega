import { describe, expect, it } from "vitest"
import { resolveRecepcionExportStatuses } from "./recepcion"

/**
 * REC-004 (auditoría 2026-09-13): la exportación de Recepción fijaba los
 * estados de la cola activa e ignoraba el filtro de la pantalla, así que
 * exportar desde "Completadas" o "Todas" entregaba otro conjunto de filas sin
 * decirlo.
 */
describe("resolveRecepcionExportStatuses", () => {
  const ACTIVE = ["sent", "partially_office_received", "office_received", "partially_received"]

  it("sin filtro exporta la cola activa, igual que el defecto de la pantalla", () => {
    expect(resolveRecepcionExportStatuses(undefined)).toEqual(ACTIVE)
    expect(resolveRecepcionExportStatuses("")).toEqual(ACTIVE)
  })

  it("respeta la tab de completadas", () => {
    expect(resolveRecepcionExportStatuses("received,closed")).toEqual(["received", "closed"])
  })

  it("respeta una etapa intermedia", () => {
    expect(resolveRecepcionExportStatuses("partially_office_received,office_received"))
      .toEqual(["partially_office_received", "office_received"])
  })

  it("respeta la tab «todas»", () => {
    const todas = [...ACTIVE, "received", "closed"].join(",")
    expect(resolveRecepcionExportStatuses(todas)).toHaveLength(6)
  })

  it("descarta estados que la pantalla de Recepción no muestra", () => {
    // `draft` y `cancelled` nunca aparecen en Recepción: un parámetro manipulado
    // no puede ampliar el conjunto exportable.
    expect(resolveRecepcionExportStatuses("draft,cancelled")).toEqual(ACTIVE)
    expect(resolveRecepcionExportStatuses("received,draft")).toEqual(["received"])
  })
})
