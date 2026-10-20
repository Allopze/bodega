// @vitest-environment jsdom

import type { ComponentProps } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { NO_SUBJECT, type InspectionSubjectOption } from "@/lib/prevention/inspection-list-query"
import { SubjectSelectField, selectableSubjects } from "./subject-select-field"

afterEach(cleanup)

const resource: InspectionSubjectOption = { source: "resource", id: "r1", name: "Extintor 12", kind: "extintor", location: "Bodega", serialNumber: null }
const vehicle: InspectionSubjectOption = { source: "vehicle", id: "v1", name: "Camión 7", kind: "camion", location: "", serialNumber: "PPU-1" }
const container: InspectionSubjectOption = { source: "container", id: "c1", name: "Contenedor A", kind: "contenedor", location: "", serialNumber: null }

function renderField(over: Partial<ComponentProps<typeof SubjectSelectField>> = {}) {
  return render(
    <SubjectSelectField
      worksiteId="w1"
      subjects={[resource, vehicle, container]}
      requiresContainer={false}
      value={NO_SUBJECT}
      onValueChange={vi.fn()}
      noneLabel="Sin sujeto del inventario"
      hint="Opcional. Ayuda del llamador."
      {...over}
    />,
  )
}

describe("selectableSubjects", () => {
  it("con plantilla de contenedores sólo ofrece los del catálogo; si no, todo el inventario", () => {
    const all = [resource, vehicle, container]
    expect(selectableSubjects(all, true)).toEqual([container])
    expect(selectableSubjects(all, false)).toEqual(all)
  })
})

describe("SubjectSelectField", () => {
  it("sin contenedores obligatorios es «Sujeto inspeccionado», con la ayuda de quien lo usa y la opción «sin sujeto»", () => {
    renderField()
    const trigger = screen.getByRole("combobox", { name: /Sujeto inspeccionado/ })
    expect((trigger as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByText("Opcional. Ayuda del llamador.")).toBeTruthy()
    // NO_SUBJECT es el valor de la opción «sin sujeto»: la muestra con su propia etiqueta.
    expect(trigger.textContent).toContain("Sin sujeto del inventario")
  })

  it("sin faena elegida el selector queda deshabilitado y dice qué falta", () => {
    renderField({ worksiteId: "", subjects: [], value: "" })
    const trigger = screen.getByRole("combobox", { name: /Sujeto inspeccionado/ })
    expect((trigger as HTMLButtonElement).disabled).toBe(true)
    expect(trigger.textContent).toContain("Selecciona una faena primero")
  })

  it("con plantilla de contenedores el campo pasa a «Contenedor inspeccionado» y es obligatorio", () => {
    renderField({ requiresContainer: true, value: "" })
    const trigger = screen.getByRole("combobox", { name: /Contenedor inspeccionado/ })
    expect(trigger.textContent).toContain("Selecciona un contenedor")
    expect(screen.queryByRole("combobox", { name: /Sujeto inspeccionado/ })).toBeNull()
  })

  it("avisa con un Callout y un enlace a Contenedores cuando la faena no tiene ninguno", () => {
    renderField({ requiresContainer: true, value: "", subjects: [resource, vehicle] })
    const notice = screen.getByRole("status")
    expect(notice.textContent).toContain("Esta faena todavía no tiene contenedores en el catálogo.")
    expect(notice.querySelector("a")?.getAttribute("href")).toBe("/admin/contenedores")
  })

  it("no avisa si la faena sí tiene contenedores, ni antes de elegir faena, ni con otras plantillas", () => {
    const { rerender } = renderField({ requiresContainer: true, value: "" })
    expect(screen.queryByRole("status")).toBeNull()

    rerender(
      <SubjectSelectField
        worksiteId=""
        subjects={[]}
        requiresContainer
        value=""
        onValueChange={vi.fn()}
        noneLabel="Sin sujeto del inventario"
        hint="Selecciona una faena para ver su inventario."
      />,
    )
    expect(screen.queryByRole("status")).toBeNull()

    rerender(
      <SubjectSelectField
        worksiteId="w1"
        subjects={[]}
        requiresContainer={false}
        value={NO_SUBJECT}
        onValueChange={vi.fn()}
        noneLabel="Sin sujeto del inventario"
        hint="Opcional."
      />,
    )
    expect(screen.queryByRole("status")).toBeNull()
  })
})
