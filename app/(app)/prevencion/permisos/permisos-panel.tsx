"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { PreventionExportButton } from "@/components/prevention/export-button"
import type { PermitRequest, PermitSignoff, PermitTemplate } from "@/db/schema"
import { PermisosList } from "./permisos-list"
import { PermitForm } from "./permit-form"
import { PermitTemplateForm } from "./permit-template-form"

interface Props {
  permits: PermitRequest[]
  templates: PermitTemplate[]
  worksites: { id: string; name: string }[]
  signoffs: PermitSignoff[]
  canManage: boolean
}

export function PermisosPanel({ permits, templates, worksites, signoffs, canManage }: Props) {
  const [activeForm, setActiveForm] = React.useState<"request" | "template" | null>(null)

  return (
    <>
      <PageHeader
        title="Permisos de trabajo (AST)"
        description="Análisis de seguridad del trabajo, aprobación y firmas por rol antes de ejecutar la tarea."
        breadcrumb={<Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "Permisos" }]} />}
        actions={
          <>
            <PreventionExportButton href="/api/prevencion/permisos/export" label="Exportar permisos" />
            {canManage ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => setActiveForm((f) => (f === "template" ? null : "template"))}>
                  <Plus size={16} className="mr-1" />
                  {activeForm === "template" ? "Cancelar" : "Nueva plantilla"}
                </Button>
                <Button size="sm" onClick={() => setActiveForm((f) => (f === "request" ? null : "request"))}>
                  <Plus size={16} className="mr-1" />
                  {activeForm === "request" ? "Cancelar" : "Solicitar permiso"}
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {canManage && activeForm === "template" ? (
        <PermitTemplateForm onDone={() => setActiveForm(null)} />
      ) : null}
      {canManage && activeForm === "request" ? (
        <PermitForm templates={templates} worksites={worksites} onDone={() => setActiveForm(null)} />
      ) : null}

      <PermisosList permits={permits} templates={templates} worksites={worksites} signoffs={signoffs} canManage={canManage} />
    </>
  )
}
