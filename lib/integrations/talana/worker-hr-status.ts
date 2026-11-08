/**
 * Resumen laboral de un trabajador según Talana, para mostrar (nunca para
 * decidir nada): tipo de contrato, término, ausencia vigente. Lo ven sólo
 * quienes tienen `admin:workers_hr`; una licencia médica es dato de salud y
 * Talana no entrega diagnóstico, sólo tipo y fechas.
 */
import { formatDate } from "@/lib/utils"
import { absenceLabel, isFixedTermContract } from "./mapping"
import { daysBetween, primaryActiveContract } from "./contract-utils"
import type { PlannerContract } from "./talana-planner"

/** Un plazo fijo que vence en este margen se muestra como «por vencer». */
export const CONTRACT_WARNING_DAYS = 30

export type TalanaContractState = "vigente" | "por_vencer" | "vencido_sin_renovar" | "finiquitado"

export interface TalanaContractSummary {
  type: string | null
  fixedTerm: boolean
  hiredOn: string | null
  startsOn: string | null
  endsOn: string | null
  state: TalanaContractState
  costCenterName: string | null
  cargo: string | null
  jefeName: string | null
}

export interface TalanaAbsenceSummary {
  label: string
  startsOn: string
  endsOn: string
  current: boolean
}

export interface TalanaWorkerSummary {
  /** Cuándo se descargaron estos datos de Talana. */
  syncedAt: string | null
  contract: TalanaContractSummary | null
  absence: TalanaAbsenceSummary | null
}

export interface TalanaAbsenceInput {
  type: string | null
  startsOn: string
  endsOn: string
  approved: boolean | null
}

export function summarizeTalanaPerson(input: {
  contracts: Pick<PlannerContract, "id" | "contractType" | "hiredOn" | "startsOn" | "endsOn" | "finiquitado" | "listedActive" | "costCenterName" | "cargo" | "jefeName">[]
  absences: TalanaAbsenceInput[]
  today: string
  syncedAt: string | null
}): TalanaWorkerSummary {
  const contracts = input.contracts
  const primary = primaryActiveContract(contracts)
  let contract: TalanaContractSummary | null = null
  const describe = (row: (typeof contracts)[number], state: TalanaContractState): TalanaContractSummary => ({
    type: row.contractType, fixedTerm: isFixedTermContract(row.contractType), hiredOn: row.hiredOn, startsOn: row.startsOn,
    endsOn: row.endsOn, state, costCenterName: row.costCenterName, cargo: row.cargo, jefeName: row.jefeName,
  })
  if (primary) {
    const nearEnd = isFixedTermContract(primary.contractType) && primary.endsOn !== null
      && daysBetween(input.today, primary.endsOn) <= CONTRACT_WARNING_DAYS
    contract = describe(primary, nearEnd ? "por_vencer" : "vigente")
  } else if (contracts.length > 0) {
    const latest = [...contracts].sort((a, b) => (b.endsOn ?? b.startsOn ?? "").localeCompare(a.endsOn ?? a.startsOn ?? "") || b.id - a.id)[0]!
    if (latest.finiquitado) contract = describe(latest, "finiquitado")
    else if (latest.endsOn && latest.endsOn < input.today) contract = describe(latest, "vencido_sin_renovar")
  }

  const approved = input.absences.filter((absence) => absence.approved !== false && absence.endsOn >= input.today)
  const current = approved.filter((absence) => absence.startsOn <= input.today).sort((a, b) => b.endsOn.localeCompare(a.endsOn))[0]
  const upcoming = approved.filter((absence) => absence.startsOn > input.today).sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0]
  const picked = current ?? upcoming
  const absence = picked
    ? { label: absenceLabel(picked.type), startsOn: picked.startsOn, endsOn: picked.endsOn, current: !!current }
    : null

  return { syncedAt: input.syncedAt, contract, absence }
}

export interface TalanaChip {
  label: string
  tone: "info" | "warning" | "neutral"
}

/** Como máximo dos chips, y sólo para lo excepcional: una ausencia en curso o un contrato que pide atención. */
export function talanaWorkerChips(summary: TalanaWorkerSummary | null | undefined): TalanaChip[] {
  if (!summary) return []
  const chips: TalanaChip[] = []
  if (summary.absence?.current) chips.push({ label: `${summary.absence.label} hasta ${formatDate(summary.absence.endsOn)}`, tone: "info" })
  const contract = summary.contract
  if (contract?.state === "vencido_sin_renovar" && contract.endsOn) chips.push({ label: `Plazo vencido el ${formatDate(contract.endsOn)}`, tone: "warning" })
  else if (contract?.state === "por_vencer" && contract.endsOn) chips.push({ label: `Plazo vence el ${formatDate(contract.endsOn)}`, tone: "warning" })
  else if (contract?.state === "finiquitado") chips.push({ label: "Finiquitado en Talana", tone: "neutral" })
  return chips
}

export const CONTRACT_STATE_LABELS: Record<TalanaContractState, string> = {
  vigente: "Vigente",
  por_vencer: "Por vencer",
  vencido_sin_renovar: "Vencido sin renovar ni finiquitar",
  finiquitado: "Finiquitado",
}
