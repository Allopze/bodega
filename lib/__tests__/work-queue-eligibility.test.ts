/**
 * `PEND-001` (auditoría 2026-09-14): la bandeja se anuncia como «todo lo que
 * requiere tu acción», pero varias ramas seleccionaban con un permiso `:view` y
 * etiquetaban la fila con una CTA de ejecución. Al seguir el enlace, la pantalla
 * escondía el control o el Server Action rechazaba la operación: una alerta que
 * la persona no podía resolver, y un contador de pendientes lleno de tareas
 * ajenas.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  actionableQueueSources, canActOnQueueSource,
  WORK_QUEUE_ACTION_PERMISSIONS, type WorkQueueSource,
} from "@/lib/services/work-queue-eligibility"

/** El permiso de lectura de cada rama, que era lo que se usaba para seleccionar. */
const SOLO_LECTURA: Record<WorkQueueSource, string> = {
  pdtp: "prevention:pdtp:view",
  pdtp_capa: "prevention:pdtp:view",
  capa: "prevention:capa:view",
  documentacion: "prevention:docs:view",
  ppa: "ppa:view",
  sst: "sst:view",
  cphs: "prevention:cphs:view",
  // E2E-004: la rama de pago nace con la misma regla, así que entra a la
  // batería de paridad con su permiso de sólo lectura.
  pago_compra: "billing:view",
}

const FUENTES = Object.keys(WORK_QUEUE_ACTION_PERMISSIONS) as WorkQueueSource[]

describe("ver un módulo no es poder resolver su trabajo", () => {
  it.each(FUENTES)("«%s» no entra en la cola con sólo el permiso de vista", (source) => {
    expect(canActOnQueueSource([SOLO_LECTURA[source]], source)).toBe(false)
  })

  it.each(FUENTES)("«%s» entra con el permiso de su acción", (source) => {
    for (const permission of WORK_QUEUE_ACTION_PERMISSIONS[source]) {
      expect(canActOnQueueSource([SOLO_LECTURA[source], permission], source)).toBe(true)
    }
  })

  it("una sesión sin permisos no recibe ninguna tarea", () => {
    expect(actionableQueueSources([])).toEqual([])
  })
})

describe("las ramas no se prestan permisos entre sí", () => {
  it("quien gestiona acciones del PDTP no hereda el módulo CAPA", () => {
    // `jefe_terreno`, `admin_contrato` y `supervisor_terreno` gestionan la
    // acción correctiva del PDTP sin ver CAPA: su fila tiene que seguir
    // llegando, y ninguna otra.
    const perfil = ["prevention:pdtp:view", "prevention:pdtp:action:manage"]
    expect(canActOnQueueSource(perfil, "pdtp_capa")).toBe(true)
    expect(canActOnQueueSource(perfil, "capa")).toBe(false)
    expect(canActOnQueueSource(perfil, "pdtp")).toBe(false)
  })

  it("quien ejecuta el programa no hereda sus acciones correctivas", () => {
    const perfil = ["prevention:pdtp:execute"]
    expect(canActOnQueueSource(perfil, "pdtp")).toBe(true)
    expect(canActOnQueueSource(perfil, "pdtp_capa")).toBe(false)
  })

  it("cualquiera de las transiciones de CAPA basta para tener trabajo ahí", () => {
    expect(canActOnQueueSource(["prevention:capa:close"], "capa")).toBe(true)
    expect(canActOnQueueSource(["prevention:capa:verify"], "capa")).toBe(true)
    // Pero reconciliar no es avanzar la acción.
    expect(canActOnQueueSource(["prevention:capa:reconcile"], "capa")).toBe(false)
  })

  it("un permiso de otra rama no abre la propia", () => {
    expect(canActOnQueueSource(["sst:manage"], "ppa")).toBe(false)
    expect(canActOnQueueSource(["ppa:review"], "sst")).toBe(false)
  })
})

describe("el catálogo de permisos de acción", () => {
  it("ninguna rama se resuelve con un permiso de lectura", () => {
    // El defecto exacto: usar la visibilidad del módulo como proxy de capacidad.
    for (const permisos of Object.values(WORK_QUEUE_ACTION_PERMISSIONS)) {
      for (const permiso of permisos) {
        expect(permiso.endsWith(":view"), `${permiso} es un permiso de lectura`).toBe(false)
      }
    }
  })

  it("cada rama declara al menos un permiso", () => {
    for (const source of FUENTES) {
      expect(WORK_QUEUE_ACTION_PERMISSIONS[source].length).toBeGreaterThan(0)
    }
  })
})

/**
 * La política vive en un módulo aparte, así que revertirlo rompe la importación
 * en vez de devolver el defecto. Lo que sí se puede fijar es que la cola no
 * vuelva a abrir una rama con el permiso de lectura.
 */
describe("la cola no vuelve a seleccionar por visibilidad", () => {
  const source = readFileSync(path.join(__dirname, "../services/operational-work-queue.ts"), "utf8")

  it.each([
    "prevention:pdtp:view", "prevention:capa:view", "prevention:docs:view",
    "ppa:view", "sst:view", "prevention:cphs:view",
  ])("ninguna rama se abre con %s", (permiso) => {
    expect(source.includes(`hasPermission(session, "${permiso}")`)).toBe(false)
  })

  it("las siete ramas de prevención pasan por la política", () => {
    const usos = source.match(/canActOnQueueSource\(/g) ?? []
    expect(usos.length).toBeGreaterThanOrEqual(7)
  })
})
