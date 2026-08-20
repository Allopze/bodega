import { describe, expect, it } from "vitest"
import { ALL_MODULE_PERMISSIONS } from "@/modules/permissions"
import { preventionModule } from "@/modules/prevention/manifest"

describe("prevention module RBAC", () => {
  it("registers current pdtp and docs permissions", () => {
    const expected = [
      "prevention:pdtp:view",
      "prevention:pdtp:execute",
      "prevention:pdtp:program:manage",
      "prevention:pdtp:override:manage",
      "prevention:pdtp:submit_review",
      "prevention:pdtp:approve",
      "prevention:pdtp:sign_legal",
      "prevention:pdtp:activate",
      "prevention:pdtp:lifecycle:manage",
      "prevention:docs:view",
      "prevention:docs:manage",
      "prevention:docs:submit_review",
      "prevention:docs:review",
      "prevention:docs:approve",
      "prevention:docs:publish",
      "prevention:docs:distribute",
      "prevention:docs:ack",
      "prevention:docs:link",
      "prevention:docs:archive",
      "prevention:docs:manage_sensitive",
      "prevention:docs:manage_restricted",
      "prevention:health:view_restrictions",
      "prevention:health:view_clinical",
      "prevention:health:manage_surveillance",
      "prevention:health:upload_clinical",
      "prevention:reserved_case:view",
      "prevention:reserved_case:investigate",
      "prevention:privacy:audit",
      "prevention:privacy:manage_requests",
      "prevention:privacy:export_subject",
      "prevention:capa:view",
      "prevention:capa:manage",
      "prevention:capa:complete",
      "prevention:capa:verify",
      "prevention:capa:close",
      "prevention:capa:override_segregation",
      "prevention:capa:reconcile",
      "prevention:incidents:view",
      "prevention:incidents:report",
      "prevention:incidents:triage",
      "prevention:incidents:investigate",
      "prevention:incidents:notify",
      "prevention:incidents:authorize_restart",
      "prevention:incidents:override_segregation",
      "prevention:incidents:close",
      "prevention:incidents:export",
      "prevention:risk:view",
      "prevention:risk:edit",
      "prevention:risk:review",
      "prevention:risk:approve",
      "prevention:risk:publish",
      "prevention:risk:override_segregation",
      "prevention:legal:view",
      "prevention:legal:assess",
      "prevention:legal:approve_applicability",
      "prevention:legal:export",
      "prevention:training:view",
      "prevention:training:manage",
      "prevention:training:approve",
      "prevention:training:deliver",
      "prevention:training:ack",
      "prevention:training:convalidate",
      "prevention:training:revoke",
      "prevention:training:export",
      "prevention:permits:view",
      "prevention:permits:manage",
      "prevention:permits:request",
      "prevention:permits:verify",
      "prevention:permits:approve",
      "prevention:permits:activate",
      "prevention:permits:suspend",
      "prevention:permits:close",
      "prevention:permits:export",
      "prevention:inspections:view",
      "prevention:inspections:manage",
      "prevention:inspections:approve",
      "prevention:inspections:execute",
      "prevention:inspections:review",
      "prevention:inspections:export",
      "prevention:cphs:view",
      "prevention:cphs:manage",
      "prevention:governance:review",
      "prevention:hygiene:view",
      "prevention:hygiene:manage",
      "prevention:hygiene:measure",
      "prevention:emergency:view",
      "prevention:emergency:manage",
      "prevention:emergency:approve",
      "prevention:emergency:drill_execute",
      "prevention:change:view",
      "prevention:change:manage",
      "prevention:change:evaluate",
      "prevention:change:approve",
      "prevention:epp:view",
      "prevention:epp:manage",
    ]
    for (const permission of expected) {
      expect(ALL_MODULE_PERMISSIONS).toContain(permission)
    }
  })

  it("does not register deleted feature permissions", () => {
    // `prevention:training:*` salió de esta lista el 2026-07-19: capacitación,
    // ODI y competencias volvieron como módulo implementado (DS 44 arts. 15 y
    // 16), no como resto de la poda de 2026-07-02.
    // `prevention:contractors:*` volvió a esta lista el 2026-07-19: Chome opera
    // como empresa contratista en faenas de terceros (CMPC, Biodiversa) con
    // dotación propia, no como empresa principal, así que las obligaciones del
    // DS 76 que el módulo cubría recaen en el mandante y no en Chome.
    // `prevention:emergency:view` salió de esta lista el 20-07-2026: era un
    // slug huérfano de la poda de 2026-07-02, sin implementación. Ahora existe
    // como capacidad real (DS 44 arts. 18-19, plan de emergencia y simulacros).
    const deleted = [
      "prevention:contractors:view",
      "prevention:contractors:manage",
      "prevention:contractors:submit",
      "prevention:contractors:accredit",
      "prevention:contractors:authorize_access",
      "prevention:contractors:coordinate",
      "prevention:contractors:export",
      "prevention:iper:view",
      "prevention:alcohol_tests:view",
      "prevention:equipment_reports:view",
      "prevention:health:view",
      "prevention:epp_matrix:view",
      "prevention:kpis:view",
      "prevention:docs:export",
      "prevention:pdtp:manage",
    ]
    for (const permission of deleted) {
      expect(ALL_MODULE_PERMISSIONS).not.toContain(permission)
    }
  })

  it("grants execution in terreno and centralizes program administration", () => {
    const rolesFor = (permission: string) => preventionModule.defaultGrants
      .filter((grant) => grant.permission === permission)
      .map((grant) => grant.roleSlug)
      .sort()

    // Todo responsable de actividad ejecuta; administrar el programa no.
    // `jefe_mantencion` entró por C2 (2026-08-13): era responsable de tres
    // actividades del programa y no podía siquiera abrir el módulo.
    expect(rolesFor("prevention:pdtp:execute")).toEqual([
      "admin_contrato",
      "administrador",
      "gerente_legal_rrhh",
      "jefe_mantencion",
      "jefe_terreno",
      "prevencionista",
      "prevencionista_faena",
      "subgerente_operaciones",
      "supervisor_terreno",
    ])
    expect(rolesFor("prevention:pdtp:program:manage")).toEqual([
      "administrador",
      "prevencionista",
    ])
    expect(rolesFor("prevention:pdtp:override:manage")).toEqual([
      "administrador",
      "prevencionista",
    ])
    expect(rolesFor("prevention:pdtp:submit_review")).toEqual([
      "administrador",
      "prevencionista",
    ])
    expect(rolesFor("prevention:pdtp:activate")).toEqual([
      "administrador",
      "jefa_chome",
    ])
    expect(rolesFor("prevention:pdtp:lifecycle:manage")).toEqual([
      "administrador",
      "jefa_chome",
    ])
  })

  it("gives campaigns and obligation cancellation their own permissions", () => {
    const rolesFor = (permission: string) => preventionModule.defaultGrants
      .filter((grant) => grant.permission === permission)
      .map((grant) => grant.roleSlug)
      .sort()

    // Las campañas se autorizaban con `prevention:pdtp:program:manage`, el
    // permiso para editar el programa anual: quien corre una campaña en faena no
    // debería poder reescribir el PDTP para conseguirlo.
    for (const permission of ["prevention:campaign:view", "prevention:campaign:manage"]) {
      expect(preventionModule.permissions).toContain(permission)
      expect(Object.keys(preventionModule.permissionMeta)).toContain(permission)
      expect(ALL_MODULE_PERMISSIONS).toContain(permission)
    }
    expect(rolesFor("prevention:campaign:manage")).toEqual([
      "administrador",
      "prevencionista",
      "prevencionista_faena",
    ])

    // Cancelar una necesidad compartía `prevention:pdtp:execute` con reportarla:
    // reportar es trabajo de terreno, anular el compromiso es gestión.
    expect(preventionModule.permissions).toContain("prevention:pdtp:obligation:cancel")
    expect(Object.keys(preventionModule.permissionMeta)).toContain("prevention:pdtp:obligation:cancel")
    expect(ALL_MODULE_PERMISSIONS).toContain("prevention:pdtp:obligation:cancel")
    expect(rolesFor("prevention:pdtp:obligation:cancel")).toEqual([
      "administrador",
      "prevencionista",
    ])
    expect(rolesFor("prevention:pdtp:obligation:cancel"))
      .not.toEqual(rolesFor("prevention:pdtp:execute"))
  })

  it("separates document preparation from approval/publication and restricts sensitive files", () => {
    const rolesFor = (permission: string) => preventionModule.defaultGrants
      .filter((grant) => grant.permission === permission)
      .map((grant) => grant.roleSlug)
      .sort()

    expect(rolesFor("prevention:docs:submit_review")).toEqual([
      "administrador",
      "prevencionista",
      "prevencionista_faena",
    ])
    expect(rolesFor("prevention:docs:approve")).toEqual(["administrador", "jefa_chome"])
    expect(rolesFor("prevention:docs:publish")).toEqual(["administrador", "jefa_chome"])
    expect(rolesFor("prevention:docs:manage_sensitive")).toEqual(["administrador", "jefa_chome"])
  })

  it("does not grant clinical or reserved-case access through general prevention roles", () => {
    const rolesFor = (permission: string) => preventionModule.defaultGrants
      .filter((grant) => grant.permission === permission)
      .map((grant) => grant.roleSlug)

    expect(rolesFor("prevention:health:view_clinical")).toEqual([])
    expect(rolesFor("prevention:health:upload_clinical")).toEqual([])
    expect(rolesFor("prevention:health:manage_surveillance")).toEqual([])
    expect(rolesFor("prevention:reserved_case:view")).toEqual([])
    expect(rolesFor("prevention:reserved_case:investigate")).toEqual([])
    expect(rolesFor("prevention:privacy:manage_requests").sort()).toEqual(["administrador", "jefa_chome"])
    expect(rolesFor("prevention:privacy:export_subject")).toEqual(["administrador"])
  })

  it("separates CAPA implementation, verification, closure and overrides", () => {
    const rolesFor = (permission: string) => preventionModule.defaultGrants
      .filter((grant) => grant.permission === permission)
      .map((grant) => grant.roleSlug)
      .sort()

    expect(rolesFor("prevention:capa:complete")).toEqual([
      "administrador", "jefa_chome", "prevencionista", "prevencionista_faena",
    ])
    expect(rolesFor("prevention:capa:verify")).toEqual(["administrador", "jefa_chome", "prevencionista"])
    expect(rolesFor("prevention:capa:close")).toEqual(["administrador", "jefa_chome"])
    // El taller no tiene cuentas: las acciones correctivas de equipos las
    // gestiona Prevención. El jefe de mantención ve la acción que originó su
    // orden de trabajo, pero no la avanza.
    expect(rolesFor("prevention:capa:view")).toContain("jefe_mantencion")
    expect(rolesFor("prevention:capa:complete")).not.toContain("jefe_mantencion")
    expect(rolesFor("prevention:capa:override_segregation")).toEqual(["administrador"])
    // MIPER-08: verificar un control MIPER se segrega por identidad igual que
    // CAPA, así que su escape vive en el mismo lugar y con los mismos roles.
    for (const permission of ["prevention:risk:override_segregation"]) {
      expect(preventionModule.permissions).toContain(permission)
      expect(Object.keys(preventionModule.permissionMeta)).toContain(permission)
      expect(ALL_MODULE_PERMISSIONS).toContain(permission)
    }
    expect(rolesFor("prevention:risk:override_segregation")).toEqual(["administrador"])
    expect(rolesFor("prevention:capa:reconcile")).toEqual(["administrador"])
    // Misma política para el reinicio de faena tras un accidente grave: quien
    // investigó o verificó las medidas no se autoriza a sí mismo el reinicio.
    expect(rolesFor("prevention:incidents:override_segregation")).toEqual(["administrador"])
  })

  it("separates training delivery from content approval and competency override", () => {
    const rolesFor = (permission: string) => preventionModule.defaultGrants
      .filter((grant) => grant.permission === permission)
      .map((grant) => grant.roleSlug)
      .sort()

    // Dictar no aprueba contenido: la segregación autor/aprobador se sostiene
    // además en el servicio, no sólo por RBAC.
    expect(rolesFor("prevention:training:deliver")).toEqual([
      "administrador", "prevencionista", "prevencionista_faena",
    ])
    expect(rolesFor("prevention:training:approve")).toEqual(["administrador", "jefa_chome"])
    // Convalidar y revocar alteran la habilitación sin sesión ni evaluación:
    // nunca se conceden a roles de terreno.
    expect(rolesFor("prevention:training:convalidate")).toEqual(["administrador", "jefa_chome"])
    expect(rolesFor("prevention:training:revoke")).toEqual(["administrador", "jefa_chome"])
    expect(rolesFor("prevention:training:convalidate")).not.toContain("prevencionista_faena")
    expect(rolesFor("prevention:training:revoke")).not.toContain("jefe_terreno")
  })

  it("splits the work-permit chain across distinct roles", () => {
    const rolesFor = (permission: string) => preventionModule.defaultGrants
      .filter((grant) => grant.permission === permission)
      .map((grant) => grant.roleSlug)
      .sort()

    // Habilitar el inicio del trabajo es el acto más sensible: el jefe de
    // terreno puede solicitar y verificar, pero no aprobar ni habilitar.
    expect(rolesFor("prevention:permits:request")).toContain("jefe_terreno")
    expect(rolesFor("prevention:permits:approve")).not.toContain("jefe_terreno")
    expect(rolesFor("prevention:permits:activate")).not.toContain("jefe_terreno")
    expect(rolesFor("prevention:permits:activate")).not.toContain("admin_contrato")
    expect(rolesFor("prevention:permits:activate")).toEqual([
      "administrador", "prevencionista", "prevencionista_faena",
    ])
    // Suspender ante riesgo es deliberadamente amplio: incluye al CPHS.
    expect(rolesFor("prevention:permits:suspend")).toContain("cphs")
    expect(rolesFor("prevention:permits:suspend")).toContain("jefe_terreno")
  })

  it("separates inspection execution from independent review", () => {
    const rolesFor = (permission: string) => preventionModule.defaultGrants
      .filter((grant) => grant.permission === permission)
      .map((grant) => grant.roleSlug)
      .sort()

    // Quien ejecuta en terreno no cierra: el servicio además valida por actor
    // que el revisor no sea el ejecutante.
    expect(rolesFor("prevention:inspections:execute")).toContain("jefe_terreno")
    expect(rolesFor("prevention:inspections:review")).not.toContain("jefe_terreno")
    expect(rolesFor("prevention:inspections:review")).not.toContain("admin_contrato")
    expect(rolesFor("prevention:inspections:approve")).toEqual([
      "administrador", "jefa_chome", "prevencionista",
    ])
    // Taller: el jefe de mantención sólo mira lo que su taller va a recibir.
    // Nadie del taller ejecuta inspecciones — el reporte llega por foto.
    expect(rolesFor("prevention:inspections:view")).toContain("jefe_mantencion")
    expect(rolesFor("prevention:inspections:execute")).not.toContain("jefe_mantencion")
    // Sube la planilla el jefe de faena, que en RBAC es `jefe_terreno`
    // (ver lib/prevention/admin-contrato-label.ts). Permiso acotado: no lo
    // tiene el taller ni quien sólo revisa.
    expect(rolesFor("prevention:inspections:ingest")).toEqual(["jefe_terreno"])
    expect(rolesFor("prevention:inspections:ingest")).not.toContain("jefe_mantencion")
  })

  it("keeps the committee as its own body and management review out of terreno", () => {
    const rolesFor = (permission: string) => preventionModule.defaultGrants
      .filter((grant) => grant.permission === permission)
      .map((grant) => grant.roleSlug)
      .sort()

    // El comité gestiona su propio órgano.
    expect(rolesFor("prevention:cphs:manage")).toContain("cphs")
    // La revisión por la dirección es de jefatura, no de terreno ni del comité.
    expect(rolesFor("prevention:governance:review")).toEqual(["administrador", "jefa_chome"])
    expect(rolesFor("prevention:governance:review")).not.toContain("cphs")
    expect(rolesFor("prevention:governance:review")).not.toContain("jefe_terreno")
  })

  it("keeps hygiene aggregates broadly visible while clinical detail stays nominative", () => {
    const rolesFor = (permission: string) => preventionModule.defaultGrants
      .filter((grant) => grant.permission === permission)
      .map((grant) => grant.roleSlug)
      .sort()

    // La vista de higiene es agregada y anonimizada: puede concederse amplio.
    expect(rolesFor("prevention:hygiene:view")).toContain("cphs")
    expect(rolesFor("prevention:hygiene:view")).toContain("jefe_terreno")
    // El resultado clínico individual sigue sin grants por defecto.
    expect(rolesFor("prevention:health:view_clinical")).toEqual([])
  })
})
