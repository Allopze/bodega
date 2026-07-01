"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { PreventionExportButton } from "@/components/prevention/export-button"
import type { Committee, CommitteeMember, CommitteeMeeting, CommitteeAgreement } from "@/db/schema"
import { ComitesList } from "./comites-list"
import { CommitteeForm } from "./committee-form"

interface Props {
  committees: Committee[]
  worksites: { id: string; name: string }[]
  users: { id: string; name: string }[]
  members: CommitteeMember[]
  meetings: CommitteeMeeting[]
  agreements: CommitteeAgreement[]
  canManage: boolean
}

export function ComitesPanel({ committees, worksites, users, members, meetings, agreements, canManage }: Props) {
  const [showForm, setShowForm] = React.useState(false)

  return (
    <>
      <PageHeader
        title="Comités y reuniones"
        description="CPHS, bipartito de capacitación, reuniones y acuerdos (N° 11-14 PDTP)."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Prevención", href: "/prevencion" },
            { label: "Comités" },
          ]} />
        }
        actions={
          <>
            <PreventionExportButton href="/api/prevencion/comites/export" label="Exportar comités" />
            {canManage ? (
              <Button onClick={() => setShowForm((current) => !current)} size="sm">
                <Plus size={16} className="mr-1" />
                {showForm ? "Cancelar" : "Nuevo comité"}
              </Button>
            ) : null}
          </>
        }
      />
      {canManage && showForm ? (
        <CommitteeForm worksites={worksites} onDone={() => setShowForm(false)} />
      ) : null}
      <ComitesList
        committees={committees}
        worksites={worksites}
        users={users}
        members={members}
        meetings={meetings}
        agreements={agreements}
        canManage={canManage}
      />
    </>
  )
}
