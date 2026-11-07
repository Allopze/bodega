import { describe, expect, it } from "vitest"
import { SYSTEM_PERMISSIONS, SYSTEM_ROLE_PERMISSIONS } from "@/lib/auth/system-rbac"
import {
  QUOTATION_TYPES,
  isRequestType,
  permissionForRequestType,
  resolveInitialRequestType,
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
    // EPP/otro se crean y envían en un acto: "enviar" ya no es un permiso propio.
    expect(permissionForRequestType("epp", "submit")).toBe("requests:create")
    expect(permissionForRequestType("otro", "submit")).toBe("requests:create")
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

  it("la jefatura de mantención ve «Repuestos» como tipo de solicitud al crear y al enviar", () => {
    const nameById = new Map(SYSTEM_PERMISSIONS.map((permission) => [permission.id, permission.name]))
    const permissionsOf = (roleId: string) => SYSTEM_ROLE_PERMISSIONS
      .filter((grant) => grant.roleId === roleId)
      .map((grant) => nameById.get(grant.permissionId)!)
    for (const roleId of ["rol-jefe-mant", "rol-sup-mantencion", "rol-admin-contrato"]) {
      expect(visibleRequestTypeOptions(permissionsOf(roleId)).map((option) => option.value), roleId).toContain("repuestos")
      expect(visibleRequestTypeOptions(permissionsOf(roleId), "submit").map((option) => option.value), roleId).toContain("repuestos")
    }
    // El mecánico no solicita: no le aparece el tipo.
    expect(visibleRequestTypeOptions(permissionsOf("rol-mecanico")).map((option) => option.value)).not.toContain("repuestos")
  })

  it("filters visible request type options for submit permissions", () => {
    expect(visibleRequestTypeOptions(["requests:create"], "submit").map((option) => option.value)).toEqual([
      "epp",
      "otro",
    ])

    expect(visibleRequestTypeOptions(["servicios:submit"], "submit").map((option) => option.value)).toEqual([
      "servicios",
    ])
  })

  it("preserves a permitted type from a specialized creation route", () => {
    const available = visibleRequestTypeOptions(["requests:create", "repuestos:create", "servicios:create"])

    expect(resolveInitialRequestType("repuestos", available)).toEqual({
      requestType: "repuestos",
      matchedCandidate: true,
    })
    expect(resolveInitialRequestType("servicios", available)).toEqual({
      requestType: "servicios",
      matchedCandidate: true,
    })
  })

  it("falls back explicitly when the requested type is invalid or unavailable", () => {
    const eppOnly = visibleRequestTypeOptions(["requests:create"])

    expect(resolveInitialRequestType("inventado", eppOnly)).toEqual({
      requestType: "epp",
      matchedCandidate: false,
    })
    expect(resolveInitialRequestType("servicios", eppOnly)).toEqual({
      requestType: "epp",
      matchedCandidate: false,
    })
    expect(resolveInitialRequestType(["epp", "servicios"], eppOnly)).toEqual({
      requestType: "epp",
      matchedCandidate: false,
    })
  })

  it("keeps quotation flow limited to repuestos and servicios", () => {
    expect([...QUOTATION_TYPES].sort()).toEqual(["repuestos", "servicios"])
  })
})
