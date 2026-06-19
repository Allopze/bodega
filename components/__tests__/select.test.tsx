// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

describe("Select", () => {
  afterEach(cleanup)

  it("keeps the searchable trigger input editable and filters visible options", () => {
    render(
      <Select searchable value="">
        <SelectTrigger aria-label="Trabajador">
          <SelectValue placeholder="Busca y selecciona trabajador" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ramon" textValue="Ramon Ernesto Mena Cid">
            Ramon Ernesto Mena Cid
          </SelectItem>
          <SelectItem value="rene" textValue="Rene Mauricio Sandoval Urbina">
            Rene Mauricio Sandoval Urbina
          </SelectItem>
        </SelectContent>
      </Select>,
    )

    fireEvent.click(screen.getByRole("combobox", { name: "Trabajador" }))

    const input = screen.getByPlaceholderText("Buscar...")

    expect(fireEvent.mouseDown(input)).toBe(true)

    fireEvent.change(input, { target: { value: "rene" } })

    expect(screen.getByText("Rene Mauricio Sandoval Urbina")).toBeVisible()
    expect(screen.getByText("Ramon Ernesto Mena Cid")).not.toBeVisible()
  })
})
