// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { DatePicker } from "./date-picker"

describe("DatePicker", () => {
  it("anuncia las flechas de navegación del calendario en español", () => {
    render(<DatePicker id="fecha" defaultValue="2026-10-15" />)
    fireEvent.click(screen.getByRole("button"))
    expect(screen.getByRole("button", { name: /mes anterior/i })).toBeTruthy()
    expect(screen.getByRole("button", { name: /mes siguiente/i })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /previous month|next month/i })).toBeNull()
  })
})
