// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { VehicleIdentity, vehicleIdentityParts } from "./vehicle-identity"

afterEach(cleanup)

describe("VehicleIdentity", () => {
  it("pone el código como nombre y el tipo con la patente debajo", () => {
    expect(vehicleIdentityParts({ code: "KA-115", plate: "DZTH-66", type: "Camión" })).toEqual({ primary: "KA-115", secondary: "Camión · DZTH-66" })
  })

  it("sin código, la patente es el nombre y no se repite", () => {
    expect(vehicleIdentityParts({ code: null, plate: "DZTH-66", type: "Camión" })).toEqual({ primary: "DZTH-66", secondary: "Camión" })
    expect(vehicleIdentityParts({ code: "DZTH-66", plate: "DZTH-66" })).toEqual({ primary: "DZTH-66", secondary: null })
  })

  it("sin ningún dato dice que no está identificado", () => {
    expect(vehicleIdentityParts({}).primary).toBe("Sin identificar")
  })

  it("con href el código es un enlace real a la ficha", () => {
    render(<VehicleIdentity code="KA-115" plate="DZTH-66" href="/flota/veh-1" />)
    const link = screen.getByRole("link", { name: "Ver ficha de KA-115" })
    expect(link.getAttribute("href")).toBe("/flota/veh-1")
    expect(screen.getByText("DZTH-66")).toBeTruthy()
  })

  it("sin href no hay enlace", () => {
    render(<VehicleIdentity code="KA-115" plate="DZTH-66" />)
    expect(screen.queryByRole("link")).toBeNull()
  })
})
