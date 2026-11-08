/**
 * Diferencias entre Talana y Chome que la sincronización NO aplica (por las
 * reglas de seguridad) y que alguien debería mirar. Son informativas: se listan
 * en `/admin/talana` y se exportan a Excel para quien administra Talana. Nada en
 * Chome depende de que se corrijan.
 */
import {
  buildPlannerLookups, primaryActiveContract,
  type PlannerContract, type PlannerPosition, type PlannerWorker, type PlannerWorksite,
} from "./talana-planner"
import { textKey, titleCase } from "./mapping"

export type DifferenceCode =
  | "plazo_vencido"
  | "finiquitado_activo_en_chome"
  | "activo_sin_contrato"
  | "sin_rut_en_chome"
  | "sin_ficha_en_chome"
  | "activo_talana_inactivo_chome"
  | "cargo_vacio"
  | "jefe_vacio"
  | "centro_sin_faena"
  | "cargo_sin_equivalencia"
  | "cargo_catalogo_faltante"
  | "varios_contratos_activos"
  | "rut_invalido"
  | "rut_repetido_en_chome"
  | "faena_distinta"
  | "cargo_distinto"
  | "jefe_distinto"

export type DifferenceFixIn = "talana" | "chome" | "revisar"

export const DIFFERENCE_META: Record<DifferenceCode, { label: string; fixIn: DifferenceFixIn }> = {
  plazo_vencido:                { label: "Plazo vencido sin renovar ni finiquitar", fixIn: "talana" },
  finiquitado_activo_en_chome:  { label: "Finiquitado en Talana, activo en Chome", fixIn: "revisar" },
  activo_sin_contrato:          { label: "Activo en Chome sin contrato en Talana", fixIn: "revisar" },
  sin_rut_en_chome:             { label: "Sin RUT en Chome", fixIn: "chome" },
  sin_ficha_en_chome:           { label: "Contrato en Talana sin ficha en Chome", fixIn: "revisar" },
  activo_talana_inactivo_chome: { label: "Activo en Talana, inactivo en Chome", fixIn: "revisar" },
  cargo_vacio:                  { label: "Sin cargo en Talana", fixIn: "talana" },
  jefe_vacio:                   { label: "Sin jefe en Talana", fixIn: "talana" },
  centro_sin_faena:             { label: "Centro de costo sin faena equivalente", fixIn: "chome" },
  cargo_sin_equivalencia:       { label: "Cargo de Talana sin equivalencia", fixIn: "chome" },
  cargo_catalogo_faltante:      { label: "Cargo que falta en el catálogo", fixIn: "chome" },
  varios_contratos_activos:     { label: "Varios contratos activos", fixIn: "talana" },
  rut_invalido:                 { label: "RUT inválido en Talana", fixIn: "talana" },
  rut_repetido_en_chome:        { label: "RUT repetido en Chome", fixIn: "chome" },
  faena_distinta:               { label: "Faena distinta", fixIn: "revisar" },
  cargo_distinto:               { label: "Cargo distinto", fixIn: "revisar" },
  jefe_distinto:                { label: "Jefe distinto", fixIn: "revisar" },
}

export interface TalanaDifference {
  code: DifferenceCode
  fixIn: DifferenceFixIn
  workerId: string | null
  worksiteId: string | null
  /** Nombre como figura en Chome o, si no tiene ficha, en Talana. */
  personLabel: string
  rut: string | null
  detail: string
}

const date = (value: string) => value.split("-").reverse().join("-")

export function computeDifferences(input: {
  today: string
  contracts: PlannerContract[]
  workers: PlannerWorker[]
  positions: PlannerPosition[]
  worksites: PlannerWorksite[]
}): TalanaDifference[] {
  const lookups = buildPlannerLookups(input)
  const out: TalanaDifference[] = []
  const workerName = (worker: PlannerWorker) => `${worker.firstName.trim()} ${worker.lastName.trim()}`
  const talanaName = (contract: PlannerContract) =>
    titleCase([contract.firstName, contract.lastNamePaternal, contract.lastNameMaternal].filter(Boolean).join(" ")) || "Sin nombre"
  const push = (code: DifferenceCode, args: { worker?: PlannerWorker | null; contract?: PlannerContract | null; rut?: string | null; detail: string }) => {
    out.push({
      code,
      fixIn: DIFFERENCE_META[code].fixIn,
      workerId: args.worker?.id ?? null,
      worksiteId: args.worker?.worksiteId ?? null,
      personLabel: args.worker ? workerName(args.worker) : args.contract ? talanaName(args.contract) : "Sin nombre",
      rut: args.rut ?? args.worker?.rut ?? args.contract?.rut ?? null,
      detail: args.detail,
    })
  }

  /* Personas de Talana ─ */
  for (const [rut, contracts] of lookups.personsByRut) {
    const matches = lookups.workersByRut.get(rut) ?? []
    const worker = matches.length === 1 ? matches[0]! : null
    const primary = primaryActiveContract(contracts)

    if (contracts.some((contract) => !contract.rutValid)) {
      if (primary) push("rut_invalido", { contract: primary, detail: "No se puede cruzar con Chome hasta corregirlo." })
      continue
    }
    if (matches.length > 1) {
      push("rut_repetido_en_chome", { contract: primary ?? contracts[0], rut, detail: `${matches.length} fichas con el mismo RUT.` })
      continue
    }

    if (!primary) {
      const latest = [...contracts].sort((a, b) => (b.endsOn ?? "").localeCompare(a.endsOn ?? "") || b.id - a.id)[0]!
      if (contracts.every((contract) => contract.finiquitado)) {
        if (worker?.isActive && latest.endsOn && latest.endsOn < input.today) {
          push("finiquitado_activo_en_chome", { worker, detail: `Término el ${date(latest.endsOn)}. Si sigue trabajando, falta registrar su contrato en Talana.` })
        }
      } else if (latest.endsOn && latest.endsOn < input.today && !latest.finiquitado) {
        push("plazo_vencido", { worker, contract: latest, detail: `Venció el ${date(latest.endsOn)}: renovar o finiquitar en Talana.` })
      }
      continue
    }

    const active = contracts.filter((contract) => contract.listedActive)
    const worksite = lookups.resolveWorksite(primary.costCenterName)
    const cargo = lookups.resolveCargo(primary.cargo)
    const jefe = lookups.resolveJefe(primary)

    if (active.length > 1) push("varios_contratos_activos", { worker, contract: primary, detail: `${active.length} contratos vigentes a la vez.` })
    if (cargo.kind === "empty") push("cargo_vacio", { worker, contract: primary, detail: "Talana no tiene cargo para su contrato vigente." })
    if (cargo.kind === "unmapped") push("cargo_sin_equivalencia", { worker, contract: primary, detail: `«${primary.cargo}»: agrégalo como alias de un cargo en Administración › Cargos.` })
    if (cargo.kind === "missing_catalog") push("cargo_catalogo_faltante", { worker, contract: primary, detail: `Crea el cargo «${cargo.target}» en Administración › Cargos.` })
    if (!jefe) push("jefe_vacio", { worker, contract: primary, detail: "Talana no tiene jefe directo para su contrato vigente." })
    if (!worksite) push("centro_sin_faena", { worker, contract: primary, detail: `Centro de costo «${primary.costCenterName ?? "sin nombre"}».` })

    if (!worker) {
      push("sin_ficha_en_chome", { contract: primary, detail: "La sincronización la crea si su centro de costo tiene faena y no hay alguien con el mismo nombre." })
      continue
    }
    if (!worker.isActive) {
      if (primary.activationProcessedAt) push("activo_talana_inactivo_chome", { worker, detail: "Se desactivó en Chome después de sincronizar; Talana sigue con contrato vigente." })
      continue
    }
    if (worksite && worksite.id !== worker.worksiteId) {
      push("faena_distinta", { worker, detail: `Chome: ${lookups.worksiteById.get(worker.worksiteId)?.name ?? "?"} · Talana: ${worksite.name}` })
    }
    const currentPosition = worker.positionId ? lookups.positionById.get(worker.positionId) : undefined
    if (cargo.kind === "ok" && currentPosition && !currentPosition.isSystem && currentPosition.id !== cargo.position.id) {
      push("cargo_distinto", { worker, detail: `Chome: ${currentPosition.name} · Talana: ${cargo.position.name}` })
    }
    if (jefe && worker.supervisor?.trim() && textKey(worker.supervisor) !== textKey(jefe.name)) {
      push("jefe_distinto", { worker, detail: `Chome: ${worker.supervisor.trim()} · Talana: ${jefe.name}` })
    }
  }

  /* Fichas activas de Chome sin persona en Talana ─ */
  for (const worker of input.workers) {
    if (!worker.isActive) continue
    if (!worker.rut) {
      push("sin_rut_en_chome", { worker, detail: "Sin RUT no se puede cruzar con Talana." })
      continue
    }
    if (!lookups.personsByRut.has(worker.rut)) {
      push("activo_sin_contrato", { worker, detail: "No figura en Talana (puede ser de otra empresa del grupo)." })
    }
  }

  return out
}
