/**
 * Lectura de la organización preventiva por faena.
 *
 * Vive en su propio archivo y no en `prevention-cphs-organization.ts` para que
 * el conector de obligaciones del PDTP pueda consumirla sin que el servicio de
 * CPHS y el conector se importen mutuamente. Ningún otro conector importa un
 * servicio de dominio, y éste no va a ser la excepción.
 */

import { and, eq, gte, inArray, isNull, or, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionCommittees,
  preventionWorksiteDelegates,
  workers,
  worksites,
} from "@/db/schema"
import { isMandateExpired } from "@/lib/prevention/cphs"
import {
  assessOrganizationCompliance,
  type OrganizationCompliance,
} from "@/lib/prevention/cphs-organization"
import { todayInChile } from "@/lib/utils"

export interface WorksiteOrganizationSummary {
  worksiteId: string
  worksiteName: string
  worksiteCode: string | null
  headcount: number
  committeeId: string | null
  committeeName: string | null
  mandateEndsOn: string | null
  mandateExpired: boolean
  delegateName: string | null
  compliance: OrganizationCompliance
}

/**
 * Una fila por faena. Se resuelve en cuatro consultas agregadas en vez de una
 * por faena: la lista completa se pinta de una sola pasada.
 *
 * Sin autorización a propósito: la aplica `listWorksiteOrganizations`, que es
 * la puerta de la UI. El barrido de obligaciones del PDTP
 * (`preventive-organization-connector.ts`) corre desde un cron sin sesión y
 * consume esta misma consulta, para que la brecha que ve la pantalla y la que
 * abre el compromiso sean por construcción la misma.
 */
export async function loadWorksiteOrganizationRows(extraFilter?: SQL | undefined): Promise<WorksiteOrganizationSummary[]> {
  const today = todayInChile()

  const worksiteRows = await db.select({ id: worksites.id, name: worksites.name, code: worksites.code })
    .from(worksites)
    .where(extraFilter ? and(eq(worksites.isActive, true), extraFilter) : eq(worksites.isActive, true))
    .orderBy(worksites.name)
  if (worksiteRows.length === 0) return []

  const ids = worksiteRows.map((row) => row.id)
  const [headcounts, committeeRows, delegateRows] = await Promise.all([
    db.select({ worksiteId: workers.worksiteId, count: sql<number>`count(*)::int` })
      .from(workers)
      .where(and(inArray(workers.worksiteId, ids), eq(workers.isActive, true)))
      .groupBy(workers.worksiteId),
    db.select({
      id: preventionCommittees.id,
      worksiteId: preventionCommittees.worksiteId,
      name: preventionCommittees.name,
      mandateEndsOn: preventionCommittees.mandateEndsOn,
    })
      .from(preventionCommittees)
      .where(and(inArray(preventionCommittees.worksiteId, ids), eq(preventionCommittees.status, "active"))),
    db.select({
      worksiteId: preventionWorksiteDelegates.worksiteId,
      firstName: workers.firstName,
      lastName: workers.lastName,
    })
      .from(preventionWorksiteDelegates)
      .innerJoin(workers, eq(workers.id, preventionWorksiteDelegates.workerId))
      .where(and(
        inArray(preventionWorksiteDelegates.worksiteId, ids),
        eq(preventionWorksiteDelegates.status, "active"),
        or(
          isNull(preventionWorksiteDelegates.termEndsOn),
          gte(preventionWorksiteDelegates.termEndsOn, today),
        ),
      )),
  ])

  const headcountBy = new Map(headcounts.map((row) => [row.worksiteId, row.count]))
  const committeeBy = new Map(committeeRows.map((row) => [row.worksiteId, row]))
  const delegateBy = new Map(delegateRows.map((row) => [row.worksiteId, row]))

  return worksiteRows.map((worksite) => {
    const headcount = headcountBy.get(worksite.id) ?? 0
    const committee = committeeBy.get(worksite.id)
    const delegate = delegateBy.get(worksite.id)
    const mandateExpired = committee ? isMandateExpired(committee.mandateEndsOn, today) : false

    return {
      worksiteId: worksite.id,
      worksiteName: worksite.name,
      worksiteCode: worksite.code,
      headcount,
      committeeId: committee?.id ?? null,
      committeeName: committee?.name ?? null,
      mandateEndsOn: committee?.mandateEndsOn ?? null,
      mandateExpired,
      delegateName: delegate ? `${delegate.lastName}, ${delegate.firstName}` : null,
      compliance: assessOrganizationCompliance({
        headcount,
        hasActiveCommittee: Boolean(committee) && !mandateExpired,
        hasActiveDelegate: Boolean(delegate),
      }),
    }
  })
}
