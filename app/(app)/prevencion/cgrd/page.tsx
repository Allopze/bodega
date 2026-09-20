import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listScopedWorksites } from "@/lib/services/ppa"
import {
  getGrdStructureStatus,
  listGrdAgreements,
  listGrdCommittees,
  listGrdMatrices,
  listGrdMeetings,
  suggestGrdSlotNotApplicableReason,
  listGrdMembers,
  listGrdThreats,
  listGrdWorkers,
} from "@/lib/services/prevention-cgrd"
import type { CgrdAccess } from "@/lib/services/prevention-cgrd-access"
import { db } from "@/db"
import { listGrdMeetingSlots } from "@/lib/services/prevention-program-slots"
import { PROGRAM_SLOT_YEAR } from "@/lib/prevention/program-slots-2026"
import { CgrdWorkbench } from "./cgrd-workbench"
import { PdtpScheduledActivityPanelServer } from "@/components/prevention/pdtp-scheduled-activity-panel-server"

export const metadata: Metadata = { title: "CGRD" }

const one = (value?: string | string[]) => Array.isArray(value) ? value[0] : value

export default async function CgrdPage({
  searchParams,
}: {
  searchParams: Promise<{ faena?: string | string[] }>
}) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:cgrd:view")) redirect("/forbidden")

  const query = await searchParams
  const resolved = resolveWorksiteScope(session)
  const scope: string[] | "all" = resolved.mode === "all" ? "all" : resolved.mode === "some" ? resolved.ids : []
  const access: CgrdAccess = { userId: session.user.id, scope: resolved, permissions: session.user.permissions }

  const worksites = await listScopedWorksites(scope)
  const worksiteId = worksites.some((item) => item.id === one(query.faena)) ? one(query.faena)! : worksites[0]?.id

  const [committees, workerCandidates, structure] = await Promise.all([
    listGrdCommittees(access),
    listGrdWorkers(access),
    worksiteId ? getGrdStructureStatus(worksiteId, access) : Promise.resolve(null),
  ])
  const committee = worksiteId ? committees.find((item) => item.worksiteId === worksiteId && item.status === "active") ?? null : null

  // La matriz GRD cuelga de la **faena**, no del comité: la N°80 le aplica
  // igual a una faena de hasta 25 personas, que tiene coordinador y no comité.
  // Cargarla junto al resto dejaba la matriz inalcanzable desde la UI en esas
  // faenas, aunque el servicio siempre la permitió.
  const matrices = worksiteId ? await listGrdMatrices(access, worksiteId) : []

  // Integrantes, actas y acuerdos sí son del comité: sin comité no existen.
  const [members, meetings, agreements] = committee
    ? await Promise.all([
        listGrdMembers(committee.id, access),
        listGrdMeetings(access, committee.id),
        listGrdAgreements(committee.id, access),
      ])
    : [[], [], []]

  /* Las casillas cuelgan de la FAENA y no del comité, igual que la matriz: la
   * N°81 se espera aunque el comité todavía no esté constituido, y ésa es
   * justamente la brecha que el checklist tiene que mostrar. */
  const meetingSlots = worksiteId ? await listGrdMeetingSlots(db, worksiteId) : []
  const slotYear = PROGRAM_SLOT_YEAR
  const notApplicableSuggestion = worksiteId
    ? await suggestGrdSlotNotApplicableReason(worksiteId)
    : null

  const latestMatrix = matrices.length > 0
    ? [...matrices].sort((a, b) => b.matrixVersion - a.matrixVersion)[0]!
    : null
  const threats = latestMatrix ? await listGrdThreats(latestMatrix.id, access) : []

  return (
    <CgrdWorkbench
      worksites={worksites}
      selectedWorksiteId={worksiteId ?? null}
      committee={committee}
      structure={structure}
      members={members}
      matrices={matrices}
      latestMatrixThreats={threats}
      meetings={meetings}
      meetingSlots={meetingSlots.map((slot) => ({
        id: slot.id,
        version: slot.version,
        slotKey: slot.slotKey,
        scheduledMonth: slot.scheduledMonth,
        scheduledWeek: slot.scheduledWeek,
        status: slot.status as "pending" | "completed" | "not_completed" | "not_applicable",
        observation: slot.observation,
        notApplicableReason: slot.notApplicableReason,
        fulfilledLabel: slot.meetingId
          ? (meetings.find((meeting) => meeting.id === slot.meetingId)?.code ?? "Acta registrada")
          : null,
      }))}
      slotYear={slotYear}
      notApplicableSuggestion={notApplicableSuggestion}
      agreements={agreements}
      workerCandidates={workerCandidates.filter((worker) => worker.worksiteId === worksiteId)}
      canManageCommittee={can(session, "prevention:cgrd:committee:manage")}
      canEditMatrix={can(session, "prevention:cgrd:matrix:edit")}
      canPublishMatrix={can(session, "prevention:cgrd:matrix:publish")}
      canManageMeetings={can(session, "prevention:cgrd:meeting:manage")}
      scheduledPanel={<PdtpScheduledActivityPanelServer connectorKey="cgrd" />}
    />
  )
}
