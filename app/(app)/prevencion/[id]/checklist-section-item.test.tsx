// @vitest-environment jsdom

/**
 * Los dos campos de texto libre de la evaluación SST —"Observación" y "Acción
 * correctiva requerida"— rendían su <label> sin relación programática con su textarea,
 * así que un lector de pantalla anunciaba ambos como campos sin nombre. Lo que se fija
 * acá es la asociación label/control, no el texto de la etiqueta.
 */

import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ItemField } from "./checklist-section-item"
import type { ChecklistItem } from "@/lib/sst/types"

const item: ChecklistItem = { id: "item-7", label: "Uso de arnés", kind: "cumple_nocumple_obs" }

function renderField(estado: "no_cumple" | "cumple") {
  return render(
    <ItemField
      item={item}
      resp={{ estado, observacion: "", accionCorrectiva: "" }}
      readOnly={false}
      onChange={() => {}}
    />,
  )
}

describe("ItemField · nombres accesibles de los campos de texto", () => {
  it("asocia 'Acción correctiva requerida' con su textarea", () => {
    renderField("no_cumple")

    const textarea = screen.getByLabelText("Acción correctiva requerida")
    expect(textarea.tagName).toBe("TEXTAREA")
    expect(textarea).toHaveAttribute("id", "item-7-accion-correctiva")
  })

  it("asocia 'Observación' con su textarea dentro del diálogo de nota", async () => {
    renderField("cumple")
    fireEvent.click(screen.getByRole("button", { name: /Agregar nota/i }))

    const textarea = await screen.findByLabelText("Observación")
    expect(textarea.tagName).toBe("TEXTAREA")
    expect(textarea).toHaveAttribute("id", "item-7-observacion")
  })
})
