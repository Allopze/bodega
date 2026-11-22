import { existsSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { registry } from "@/modules/registry"
import { FIELD_APP_IDS, FIELD_APPS, findFieldApp, isFieldAppId } from "@/lib/apps/field-apps"

describe("apps del teléfono", () => {
  it("son tres, en este orden", () => {
    expect(FIELD_APP_IDS).toEqual(["ppa", "mantencion", "tae"])
    expect(FIELD_APPS.map((app) => app.id)).toEqual(["ppa", "mantencion", "tae"])
  })

  it("cada una pertenece a un módulo del registry", () => {
    const moduleIds = new Set((registry as readonly { id: string }[]).map((mod) => mod.id))
    for (const app of FIELD_APPS) expect(moduleIds.has(app.moduleId), app.moduleId).toBe(true)
  })

  it("cada ícono existe en public/", () => {
    for (const app of FIELD_APPS) expect(existsSync(path.join(process.cwd(), "public", app.iconSrc)), app.iconSrc).toBe(true)
  })

  it("reconoce sólo sus ids", () => {
    expect(isFieldAppId("tae")).toBe(true)
    expect(isFieldAppId("x")).toBe(false)
    expect(findFieldApp("mantencion")?.label).toBe("Mantención")
    expect(findFieldApp("bodega")).toBeUndefined()
  })
})
