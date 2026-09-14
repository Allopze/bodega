/**
 * `PEND-002` (auditoría 2026-09-14): los cinco roles que ejecutan actividades
 * del PDTP tenían `prevention:pdtp:execute` en el manifiesto de Prevención —y
 * la cola les producía trabajo— pero no estaban en los grants de Operations, así
 * que `/pendientes` los mandaba a prohibido y el menú no les mostraba la
 * bandeja. Una cola unificada que no alcanza a quien ejecuta el trabajo obliga
 * a recorrer módulo por módulo.
 *
 * Vive en `lib/__tests__/` y no junto al manifiesto porque `modules/` sólo
 * admite el registro y los manifiestos vivos (`frozen-modular-migration`).
 *
 * Esto no fija una lista: fija la **paridad**. Si mañana otro rol recibe un
 * permiso que la cola usa para producirle tareas, esta prueba lo reclama.
 */
import { describe, expect, it } from "vitest"
import { operationsModule } from "@/modules/operations/manifest"
import { preventionModule } from "@/modules/prevention/manifest"
import { WORK_QUEUE_ACTION_PERMISSIONS } from "@/lib/services/work-queue-eligibility"

type Grant = { roleSlug: string; permission: string }

const opsGrants = operationsModule.defaultGrants as readonly Grant[]
const preventionGrants = preventionModule.defaultGrants as readonly Grant[]

const seeQueue = new Set(
  opsGrants.filter((grant) => grant.permission === "operations:view_work").map((grant) => grant.roleSlug),
)

/** Todos los permisos con los que la cola puede producirle trabajo a alguien. */
const actionPermissions = new Set(Object.values(WORK_QUEUE_ACTION_PERMISSIONS).flat())

describe("quien recibe trabajo en la cola puede abrirla", () => {
  it("los cinco ejecutores PDTP del hallazgo tienen acceso", () => {
    for (const role of [
      "admin_contrato", "jefe_terreno", "supervisor_terreno",
      "gerente_legal_rrhh", "subgerente_operaciones",
    ]) {
      expect(seeQueue.has(role), `${role} no puede abrir /pendientes`).toBe(true)
    }
  })

  it("ningún rol de prevención recibe tareas que no puede ir a buscar", () => {
    const conTrabajo = preventionGrants
      .filter((grant) => actionPermissions.has(grant.permission))
      .map((grant) => grant.roleSlug)

    const sinBandeja = [...new Set(conTrabajo)].filter((role) => !seeQueue.has(role)).sort()
    expect(sinBandeja, "estos roles reciben trabajo en la cola y no pueden abrirla").toEqual([])
  })

  it("el permiso de la bandeja sigue siendo el que la ruta exige", () => {
    // La paridad se rompe también si alguien renombra el permiso en un solo lado.
    expect(operationsModule.permissions).toContain("operations:view_work")
    expect(operationsModule.nav[0]!.items[0]!.permissions).toEqual(["operations:view_work"])
  })
})
