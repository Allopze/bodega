import { describe, expect, it } from "vitest"
import { registry } from "@/modules/registry"
import { AREA_TREE } from "@/components/layout/nav-items"
import { NAV_ICONS } from "@/components/layout/nav-icons"
import {
  APPS,
  APP_CRON_JOBS,
  NON_APP_MODULES,
  appForEntityType,
  appIdsReferencedByEntityMap,
  modulesWithoutApp,
} from "../catalog"

const appIds = new Set(APPS.map((app) => app.id))

describe("catálogo de apps", () => {
  it("cada módulo del registry es una app o está declarado como no-app", () => {
    // Un módulo nuevo sin entrada en APP_META desaparecería de TI › Apps en silencio.
    expect(modulesWithoutApp()).toEqual([])
    for (const mod of registry) {
      expect(appIds.has(mod.id) || NON_APP_MODULES.has(mod.id)).toBe(true)
    }
  })

  it("la entrada de cada app es una pantalla del menú (o la portada de su área)", () => {
    const navHrefs = new Set(AREA_TREE.flatMap((area) => area.items.flatMap((item) => [item.href, ...(item.children ?? []).map((child) => child.href)])))
    // Portadas de área que no son un ítem del menú pero sí una página.
    const areaIndexes = new Set(["/admin", "/prevencion"])
    for (const app of APPS) {
      expect(navHrefs.has(app.href) || areaIndexes.has(app.href), `${app.id} → ${app.href}`).toBe(true)
    }
  })

  it("cada ícono existe en el mapa de íconos de navegación", () => {
    for (const app of APPS) expect(NAV_ICONS[app.iconName], app.id).toBeDefined()
  })

  it("el mapeo de auditoría y los jobs sólo nombran apps registradas", () => {
    for (const appId of appIdsReferencedByEntityMap()) expect(appIds.has(appId), appId).toBe(true)
    for (const job of APP_CRON_JOBS) expect(appIds.has(job.appId), job.jobName).toBe(true)
  })

  it("no repite un job", () => {
    const names = APP_CRON_JOBS.map((job) => job.jobName)
    expect(new Set(names).size).toBe(names.length)
  })

  it.each([
    ["purchase_request", "requests"],
    ["purchase_request_item", "requests"],
    ["purchase_order_invoice", "purchasing"],
    ["fuel_vehicle", "flota"],
    ["fuel_provider_mapping", "combustibles"],
    ["fleet_onway_settings", "flota"],
    ["mant_work_order", "mantencion_equipos"],
    ["spare_parts_catalog_export", "repuestos"],
    ["risk_legal:risk:miper", "prevention"],
    ["inspection:run", "prevention"],
    ["prevention_container", "admin"],
    ["prevention_incident_register", "prevention"],
    ["sst_evaluation", "sst"],
    ["sst_document_version", "prevention"],
    ["it_ticket", "ti"],
    ["worker_driver_license", "admin"],
    ["user_invitation", "admin"],
    ["billing_sync_run", "billing"],
    ["dte_portal_settings", "billing"],
    ["operational_integrity_case", "operations"],
  ])("%s pertenece a %s", (entityType, appId) => {
    expect(appForEntityType(entityType)).toBe(appId)
  })

  it("un tipo desconocido no se asigna a ninguna app", () => {
    expect(appForEntityType("algo_nuevo_sin_mapear")).toBeNull()
  })
})
