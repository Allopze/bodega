import { and, asc, desc, eq, sql } from "drizzle-orm"
import { roles, userRoles, users, workers, worksites, worksiteUsers } from "@/db/schema"
import { headcountFromSexCounts } from "@/lib/prevention/miper/names"
import { getCompanyProfile } from "@/lib/services/system-settings"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import type { Client } from "./shared"

export type MiperHeaderPrefill = {
  companyName: string; companyRut: string; companyAddress: string; economicActivity: string; adherentNumber: string
  companyCommune: string | null; worksiteName: string
  siteRepresentativeUserId: string | null; siteRepresentativeName: string | null
  headcount: { total: number; male: number; female: number; other: number; unrecorded: number }
}

/**
 * Antecedentes del RE-04 desde lo que la plataforma ya sabe (§4.8 del spec):
 * nada de esto se escribe dos veces. El representante es quien tiene el rol
 * `admin_contrato` en la faena —el representante de CHOME en ese contrato—,
 * nunca el representante legal corporativo.
 */
export async function buildMiperHeaderPrefill(client: Client, worksiteId: string): Promise<MiperHeaderPrefill> {
  const [profile, [worksite], [representative], sexCounts] = await Promise.all([
    getCompanyProfile(),
    client.select({ name: worksites.name, commune: worksites.commune }).from(worksites).where(eq(worksites.id, worksiteId)).limit(1),
    client.select({ id: users.id, name: users.name }).from(worksiteUsers)
      .innerJoin(userRoles, eq(userRoles.userId, worksiteUsers.userId))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(users, eq(users.id, worksiteUsers.userId))
      .where(and(eq(worksiteUsers.worksiteId, worksiteId), eq(roles.name, "admin_contrato"), eq(users.isActive, true)))
      .orderBy(desc(worksiteUsers.isPrimary), asc(users.name)).limit(1),
    client.select({ sex: workers.sex, count: sql<number>`count(*)::int` }).from(workers)
      .where(and(eq(workers.worksiteId, worksiteId), eq(workers.isActive, true))).groupBy(workers.sex),
  ])
  if (!worksite) throw new RiskLegalDomainError("Faena no encontrada.")
  return {
    companyName: profile.name,
    companyRut: profile.rut,
    companyAddress: profile.address,
    economicActivity: profile.businessActivity,
    adherentNumber: profile.adherentNumber,
    companyCommune: worksite.commune,
    worksiteName: worksite.name,
    siteRepresentativeUserId: representative?.id ?? null,
    siteRepresentativeName: representative?.name ?? null,
    headcount: headcountFromSexCounts(sexCounts),
  }
}
