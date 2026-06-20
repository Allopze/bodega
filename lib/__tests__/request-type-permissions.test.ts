import { describe, expect, it } from "vitest"
import {
  QUOTATION_TYPES,
  isRequestType,
  permissionForRequestType,
  visibleRequestTypeOptions,
} from "@/lib/request-types"

describe("request type permissions", () => {
  it("recognizes only supported request type values", () => {
    expect(isRequestType("epp")).toBe(true)
    expect(isRequestType("repuestos")).toBe(true)
    expect(isRequestType("servicios")).toBe(true)
    expect(isRequestType("otro")).toBe(true)
    expect(isRequestType("")).toBe(false)
    expect(isRequestType("compra_directa")).toBe(false)
    expect(isRequestType(null)).toBe(false)
  })

  it("requires module-specific create permissions for quotation request types", () => {
    expect(permissionForRequestType("epp", "create")).toBe("requests:create")
    expect(permissionForRequestType("otro", "create")).toBe("requests:create")
    expect(permissionForRequestType("repuestos", "create")).toBe("repuestos:create")
    expect(permissionForRequestType("servicios", "create")).toBe("servicios:create")
  })

  it("requires module-specific submit permissions for quotation request types", () => {
    expect(permissionForRequestType("epp", "submit")).toBe("requests:submit")
    expect(permissionForRequestType("otro", "submit")).toBe("requests:submit")
    expect(permissionForRequestType("repuestos", "submit")).toBe("repuestos:submit")
    expect(permissionForRequestType("servicios", "submit")).toBe("servicios:submit")
  })

  it("shows request type options from effective permissions", () => {
    expect(visibleRequestTypeOptions(["requests:create"]).map((option) => option.value)).toEqual([
      "epp",
      "otro",
    ])

    expect(visibleRequestTypeOptions(["repuestos:create", "servicios:create"]).map((option) => option.value)).toEqual([
      "repuestos",
      "servicios",
    ])
  })

  it("filters visible request type options for submit permissions", () => {
    expect(visibleRequestTypeOptions(["requests:submit"], "submit").map((option) => option.value)).toEqual([
      "epp",
      "otro",
    ])

    expect(visibleRequestTypeOptions(["servicios:submit"], "submit").map((option) => option.value)).toEqual([
      "servicios",
    ])
  })

  it("keeps quotation flow limited to repuestos and servicios", () => {
    expect([...QUOTATION_TYPES].sort()).toEqual(["repuestos", "servicios"])
  })
})
