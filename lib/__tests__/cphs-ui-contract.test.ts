import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const source = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8")

describe("contratos visuales de las pantallas CPHS", () => {
  it("proyecta las acciones globales de programa y certificación al PageHeader", () => {
    const programPage = source("app/(app)/prevencion/cphs/[committeeId]/programa/page.tsx")
    const certificationPage = source("app/(app)/prevencion/cphs/[committeeId]/certificacion/page.tsx")

    expect(programPage).toContain("actions={canManage ? <ProgramHeaderActions")
    expect(certificationPage).toContain("actions={canCertify ? <CertificationHeaderActions")
  })

  it("hace accionables los KPI y evita guiones como estados vacíos", () => {
    const program = source("app/(app)/prevencion/cphs/[committeeId]/programa/program-panel.tsx")
    const certification = source("app/(app)/prevencion/cphs/[committeeId]/certificacion/certification-panel.tsx")
    const worksites = source("app/(app)/prevencion/faenas/worksite-organization-list.tsx")

    expect(program).toContain("setActivityFilter")
    expect(certification).toContain("setRequirementFilter")
    expect(worksites).toContain("setOrganizationFilter")
    expect(program).toContain("Sin vencimientos")
    expect(certification).toContain("Se define al presentar")
    expect(certification).toContain("Pendiente de auditoría")
  })

  it("formatea fechas de calendario con las utilidades compartidas", () => {
    const detail = source("app/(app)/prevencion/cphs/[committeeId]/committee-detail.tsx")
    const program = source("app/(app)/prevencion/cphs/[committeeId]/programa/program-panel.tsx")
    const certification = source("app/(app)/prevencion/cphs/[committeeId]/certificacion/certification-panel.tsx")
    const profile = source("app/(app)/prevencion/faenas/[worksiteId]/worksite-profile.tsx")
    const worksites = source("app/(app)/prevencion/faenas/worksite-organization-list.tsx")

    expect(detail).toContain("formatDate(committee.constitutedOn)")
    expect(detail).toContain("formatDate(committee.mandateEndsOn)")
    expect(program).toContain("formatDate(activity.dueOn)")
    expect(certification).toContain("formatDate(selected.gapsDeadlineOn)")
    expect(certification).toContain("formatDate(selected.validUntilOn)")
    expect(profile).toContain("formatDate(profile.committee.mandateEndsOn)")
    expect(profile).toContain("formatDate(profile.delegate.designatedOn)")
    expect(worksites).toContain("formatDate(item.mandateEndsOn)")
  })

  it("usa EmptyState con CTA y traduce el estado documental", () => {
    const detail = source("app/(app)/prevencion/cphs/[committeeId]/committee-detail.tsx")
    const commissions = source("app/(app)/prevencion/cphs/[committeeId]/committee-commissions.tsx")
    const documents = source("app/(app)/prevencion/cphs/[committeeId]/committee-documents.tsx")
    const profile = source("app/(app)/prevencion/faenas/[worksiteId]/worksite-profile.tsx")

    expect(detail).toContain("<EmptyState")
    expect(commissions).toContain("<EmptyState")
    expect(documents).toContain("<EmptyState")
    expect(profile).toContain("<EmptyState")
    expect(documents).toContain("SST_DOCUMENT_STATUS_LABELS[document.status]")
    expect(documents).not.toContain(">{document.status}</Badge>")
  })

  it("da un nombre accesible único a cada acción de comisión", () => {
    const commissions = source("app/(app)/prevencion/cphs/[committeeId]/committee-commissions.tsx")

    expect(commissions).toContain('aria-label={`Asignar integrante a ${commissionName}`}')
  })
})
