// @vitest-environment jsdom

/**
 * Regresión del defecto que motivó esta barra: **un filtro activo desaparecía al
 * tocar cualquier otro control**.
 *
 * Los seis `Pdtp*Picker` de `pdtp-sheet-table-ui.tsx` construían el querystring
 * desde cero (`new URLSearchParams({ hoja, vista })` y luego `params.set(...)`
 * clave por clave), así que cada uno tenía que conocer *todos* los demás filtros
 * y recibirlos como props. Cuando se agregó `?asignado=`, no se añadió a los seis
 * sitios: elegir "Sólo las asignadas a mí" y después cambiar de faena, de mes o
 * de hoja lo borraba en silencio. Lo mismo le habría pasado al siguiente
 * parámetro que se agregara.
 *
 * Lo que estos tests fijan no es "asignado sobrevive" sino la propiedad que lo
 * garantiza: **la barra hace un patch sobre la URL vigente, no una URL nueva**.
 * Por eso el caso principal usa una clave inventada (`futuro`) además de
 * `asignado`: si alguien vuelve a construir el querystring desde cero, ese caso
 * falla aunque se haya acordado de propagar `asignado` a mano.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { PdtpActivitiesFilters, type PdtpActivitiesFiltersProps } from "./pdtp-activities-filters"

const replace = vi.fn()
let currentSearch = ""

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => "/prevencion/pdtp/actividades",
  useSearchParams: () => new URLSearchParams(currentSearch),
}))

beforeEach(() => {
  replace.mockClear()
  currentSearch = ""
})

afterEach(cleanup)

const BASE: PdtpActivitiesFiltersProps = {
  year: 2026,
  years: [2026],
  programId: "prog-1",
  programs: [{ id: "prog-1", title: "Programa de Trabajo Preventivo", year: 2026, version: 1 }],
  sheetCode: "pdtp_general",
  sheets: [
    { code: "pdtp_general", label: "Programa preventivo general" },
    { code: "pdtp_gruas", label: "Programa grúas" },
  ],
  worksiteId: "faena-1",
  worksites: [
    { id: "faena-1", name: "Horcones" },
    { id: "faena-2", name: "Masisa" },
  ],
  objectiveId: undefined,
  objectives: [{ id: "obj-1", code: "O1", name: "Liderazgo" }],
  month: 9,
  week: 3,
  viewMode: "anual",
  assigneeFilterActive: false,
  hasAssignees: true,
}

/** La query de la última llamada a `router.replace`. */
function lastQuery() {
  expect(replace).toHaveBeenCalled()
  const url = replace.mock.calls.at(-1)![0] as string
  return new URLSearchParams(url.split("?")[1] ?? "")
}

describe("PdtpActivitiesFilters — el contexto sobrevive a cambiar de filtro", () => {
  it("conserva los parámetros que no toca, incluidos los que no conoce", async () => {
    currentSearch = "asignado=yo&objetivo=obj-1&futuro=valor-nuevo&faena=faena-1"
    render(<PdtpActivitiesFilters {...BASE} objectiveId="obj-1" assigneeFilterActive />)

    fireEvent.click(screen.getByRole("combobox", { name: "Seleccionar faena" }))
    fireEvent.click(screen.getByRole("option", { name: "Masisa" }))

    const query = lastQuery()
    expect(query.get("faena"), "la faena sí cambia").toBe("faena-2")
    // El defecto original, ahora bajo test.
    expect(query.get("asignado"), "«sólo las asignadas a mí» se perdía al cambiar de faena").toBe("yo")
    expect(query.get("objetivo")).toBe("obj-1")
    // La clave inventada es lo que distingue "hicimos un patch" de "nos acordamos
    // de copiar asignado": una reconstrucción desde cero la dejaría fuera.
    expect(query.get("futuro"), "la barra reconstruyó la URL en vez de parchearla").toBe("valor-nuevo")
  })

  it("conserva el contexto al cambiar de mes", async () => {
    currentSearch = "asignado=yo&faena=faena-1&hoja=pdtp_general"
    render(<PdtpActivitiesFilters {...BASE} assigneeFilterActive />)

    fireEvent.click(screen.getByRole("combobox", { name: "Seleccionar mes" }))
    fireEvent.click(screen.getByRole("option", { name: "Oct" }))

    const query = lastQuery()
    expect(query.get("mes")).toBe("10")
    expect(query.get("asignado")).toBe("yo")
    expect(query.get("hoja")).toBe("pdtp_general")
  })

  it("retira «asignado» al volver al agregado, porque sin faena no hay a quién nombrar", async () => {
    currentSearch = "asignado=yo&faena=faena-1"
    render(<PdtpActivitiesFilters {...BASE} assigneeFilterActive />)

    fireEvent.click(screen.getByRole("combobox", { name: "Seleccionar faena" }))
    fireEvent.click(screen.getByRole("option", { name: "Todas las faenas autorizadas" }))

    const query = lastQuery()
    expect(query.get("faena")).toBeNull()
    // No es una excepción a la regla de arriba: `page.tsx` sólo consulta
    // asignados con faena, así que dejarlo activo sería un filtro sin efecto.
    expect(query.get("asignado")).toBeNull()
  })
})

describe("PdtpActivitiesFilters — densidad de controles (A2)", () => {
  it("no expone más de tres selectores primarios", () => {
    render(<PdtpActivitiesFilters {...BASE} />)

    // Faena, Período y Hoja. Año, Programa y Objetivo viven tras "Más filtros",
    // que no monta su contenido hasta abrirse.
    expect(screen.getByRole("combobox", { name: "Seleccionar faena" })).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "Seleccionar mes" })).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "Seleccionar hoja" })).toBeTruthy()
    expect(screen.queryByRole("combobox", { name: "Seleccionar año" })).toBeNull()
    expect(screen.queryByRole("combobox", { name: "Seleccionar objetivo" })).toBeNull()
  })

  it("oculta el selector de semana en la vista anual sin borrar `?semana` de la URL", async () => {
    // La semana no cambia nada observable en la vista anual: el control era uno
    // de los siete comboboxes que hacían fallar A2. Lo que se oculta es el
    // control, no el estado — si no, un deep link con `semana=` se degradaría al
    // primer clic en cualquier otro filtro.
    currentSearch = "semana=3&faena=faena-1"
    render(<PdtpActivitiesFilters {...BASE} viewMode="anual" />)
    expect(screen.queryByRole("combobox", { name: "Seleccionar semana" })).toBeNull()

    fireEvent.click(screen.getByRole("combobox", { name: "Seleccionar mes" }))
    fireEvent.click(screen.getByRole("option", { name: "Oct" }))
    expect(lastQuery().get("semana")).toBe("3")
  })

  it("muestra el selector de semana en la vista semanal, donde sí tiene efecto", () => {
    render(<PdtpActivitiesFilters {...BASE} viewMode="semana" />)
    expect(screen.getByRole("combobox", { name: "Seleccionar semana" })).toBeTruthy()
  })
})

describe("PdtpActivitiesFilters — chips de filtros del Sheet", () => {
  it("anuncia el objetivo activo y lo deja quitar", async () => {
    currentSearch = "objetivo=obj-1&faena=faena-1"
    render(<PdtpActivitiesFilters {...BASE} objectiveId="obj-1" />)

    expect(screen.getByText("O1 · Liderazgo")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Eliminar filtro Objetivo" }))

    const query = lastQuery()
    expect(query.get("objetivo")).toBeNull()
    expect(query.get("faena"), "quitar un chip no debe arrastrar el resto").toBe("faena-1")
  })

  it("no anuncia el año cuando es el que la pantalla habría elegido sola", () => {
    render(<PdtpActivitiesFilters {...BASE} />)
    expect(screen.queryByText("Año")).toBeNull()
  })

  it("anuncia el año cuando difiere del default, que es lo que evita que bajarlo al Sheet lo vuelva invisible", () => {
    render(<PdtpActivitiesFilters {...BASE} year={2025} years={[2025, 2026]} />)
    expect(screen.getByText("2025")).toBeTruthy()
  })
})
