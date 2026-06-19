import { describe, expect, it } from "vitest"
import {
  permissionForRequestType,
  visibleRequestTypeOptions,
} from "@/lib/request-types"

describe("request type permissions", () => {
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
})
