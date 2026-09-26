import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listScopedWorksites } from "@/lib/services/ppa"
import {
  listAlcoholTestDispatches,
  listAlcoholTests,
  listAlcotestEquipment,
  listAlcotestWorkers,
} from "@/lib/services/prevention-alcotest"
import { listAlcotestSlotsForWorksite, resolveAlcotestSlotFacts } from "@/lib/services/prevention-alcotest-slots"
import { resolveProgramActivationPeriod } from "@/lib/services/prevention-program-slots"
import { resolveProgramSlotYear } from "@/lib/prevention/program-slots-2026"
import { getPdtpOperationalYears } from "@/lib/services/prevention-pdtp"
import { formatDateTime } from "@/lib/utils"
import { AlcotestWorkbench } from "./alcotest-workbench"
import { PdtpScheduledActivityPanelServer } from "@/components/prevention/pdtp-scheduled-activity-panel-server"

export const metadata: Metadata = { title: "Alcotest" }

function one(value: string | string[] | undefined) {
  return typeof value === "string" ? value.trim() : Array.isArray(value) ? value[0]?.trim() : undefined
}

export default async function AlcotestPage({
  searchParams,
}: {
  searchParams: Promise<{ faena?: string | string[]; anio?: string | string[] }>
}) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:alcotest:view")) redirect("/forbidden")

  const resolved = resolveWorksiteScope(session)
  const scope: string[] | "all" = resolved.mode === "all" ? "all" : resolved.mode === "some" ? resolved.ids : []
  const [worksites, tests, dispatches, workers, equipment] = await Promise.all([
    listScopedWorksites(scope),
    listAlcoholTests(scope),
    listAlcoholTestDispatches(scope),
    listAlcotestWorkers(scope),
    listAlcotestEquipment(scope),
  ])

  /* Las casillas cuelgan de UNA faena: sin una elegida no hay checklist que
   * mostrar. Se cae a la primera del alcance, igual que CGRD. */
  const query = await searchParams
  const requested = one(query.faena)
  const worksiteId = worksites.some((item) => item.id === requested) ? requested! : worksites[0]?.id
  // PREV-C03.4/C03.7: el año de las casillas viene de ?anio o, si falta, del
  // año operativo (en enero puede seguir siendo el anterior).
  const slotYear = resolveProgramSlotYear(one(query.anio), (await getPdtpOperationalYears()).primary)

  const slots = worksiteId
    ? await listAlcotestSlotsForWorksite(scope, worksiteId, slotYear)
    : []
  const facts = await resolveAlcotestSlotFacts(slots)
  const activationPeriod = await resolveProgramActivationPeriod(worksiteId, slotYear)

  const slotRows = slots.map((slot) => ({
    id: slot.id,
    version: slot.version,
    slotKey: slot.slotKey,
    kind: slot.kind as "control" | "envio",
    scheduledMonth: slot.scheduledMonth,
    scheduledWeek: slot.scheduledWeek,
    status: slot.status as "pending" | "completed" | "not_completed" | "not_applicable",
    observation: slot.observation,
    notApplicableReason: slot.notApplicableReason,
    activeEvidenceCount: slot.activeEvidenceCount,
    fulfilledLabel: slot.testId
      ? (() => {
          const test = facts.tests.get(slot.testId)
          return test ? `Control del ${formatDateTime(test.performedAt)} · ${test.result}` : "Control registrado"
        })()
      : slot.dispatchId
        ? (() => {
            const dispatch = facts.dispatches.get(slot.dispatchId!)
            return dispatch ? `Envío del ${formatDateTime(dispatch.sentAt)} a ${dispatch.recipient}` : "Envío registrado"
          })()
        : null,
  }))

  return (
    <AlcotestWorkbench
      worksites={worksites}
      selectedWorksiteId={worksiteId ?? null}
      slotRows={slotRows}
      slotYear={slotYear}
      activationPeriod={activationPeriod}
      initialTests={tests}
      initialDispatches={dispatches}
      workers={workers}
      equipment={equipment}
      canRegister={can(session, "prevention:alcotest:register")}
      canDispatch={can(session, "prevention:alcotest:dispatch")}
      scheduledPanel={<PdtpScheduledActivityPanelServer connectorKey="alcotest" />}
    />
  )
}
