import { describe, expect, it } from "vitest"
import { URGENCY_LABELS, URGENCY_OPTIONS, urgencyLabel } from "@/lib/urgency-labels"
import { URGENCY_LABELS as EXPORT_URGENCY_LABELS } from "@/lib/reports/export-module/labels"

/**
 * UX-10 (auditoría UI/UX 2026-11-07): la misma urgencia se leía «CRÍTICO» en la
 * insignia de Solicitudes, Compras y Pendientes, «Urgencia crítica» en la
 * cabecera y «Crítica» en el Inicio. El rótulo califica a «urgencia», así que es
 * femenino en todas partes, y el Excel de solicitudes dice lo mismo que la pantalla.
 */
describe("etiquetas de urgencia", () => {
  it("concuerdan con «urgencia»: Normal, Alta, Crítica", () => {
    expect(URGENCY_LABELS).toEqual({ normal: "Normal", high: "Alta", critical: "Crítica" })
    expect(urgencyLabel("critical")).toBe("Crítica")
    expect(URGENCY_OPTIONS.map((option) => option.label)).toEqual(["Normal", "Alta", "Crítica"])
  })

  it("el exporte de solicitudes usa las mismas etiquetas que la pantalla", () => {
    expect(EXPORT_URGENCY_LABELS).toEqual(URGENCY_LABELS)
  })

  it("un valor desconocido se muestra tal cual y uno ausente como guion", () => {
    expect(urgencyLabel("otra")).toBe("otra")
    expect(urgencyLabel(null)).toBe("—")
  })
})
