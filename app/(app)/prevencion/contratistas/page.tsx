import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { Button } from "@/components/ui/button"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import {
  listAccreditationGaps,
  listContractorContracts,
} from "@/lib/services/prevention-contractors"
import { ContractorContractList } from "./contractor-contract-list"

export const metadata: Metadata = { title: "Empresas contratistas" }

export default async function ContratistasPage() {
  let session
  try { session = await requirePermission("prevention:contractors:view") }
  catch { redirect("/forbidden") }

  const access = {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }
  const [contracts, gaps] = await Promise.all([
    listContractorContracts(access),
    listAccreditationGaps(access),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Empresas contratistas"
        description="Registro de faena, acreditación documental y control de ingreso conforme al DS 76 y la Ley 20.123."
        breadcrumb={<Breadcrumbs items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Contratistas" },
        ]} />}
        actions={
          session.user.permissions.includes("prevention:contractors:export") ? (
            <Button asChild variant="secondary">
              <Link href="/api/prevencion/contratistas/export">Exportar XLSX</Link>
            </Button>
          ) : undefined
        }
      />
      <ContractorContractList
        contracts={contracts.map((row) => ({
          id: row.contract.id,
          code: row.contract.code,
          status: row.contract.status,
          relationship: row.contract.relationship,
          accessBlocked: row.contract.accessBlocked,
          accessBlockReason: row.contract.accessBlockReason,
          startsOn: row.contract.startsOn,
          endsOn: row.contract.endsOn,
          worksiteId: row.contract.worksiteId,
          worksiteName: row.worksiteName,
          companyName: row.companyName,
          companyRut: row.companyRut,
          workerCount: row.workerCount,
          accreditedCount: row.accreditedCount,
        }))}
        blockingGapCount={gaps.filter((gap) => gap.enforcement === "blocking").length}
      />
    </PageContainer>
  )
}
