"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { AGENT_TYPE_LABELS } from "@/lib/prevention/hygiene"
import { createExposureAgentAction, createExposureGroupAction, createSurveillanceProgramAction } from "./actions"
import { Field } from "@/components/ui/field"
import { useOperation } from "@/lib/hooks/use-operation"

interface AgentOption {
  id: string
  code: string
  name: string
  unit: string
}

/* ── Alta de agente ───────────────────────────────────────────────────────── */

export function NewAgentDialog() {
  const [open, setOpen] = React.useState(false)
  const [agentType, setAgentType] = React.useState(Object.keys(AGENT_TYPE_LABELS)[0] ?? "physical")
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const limit = String(form.get("permissibleLimit") ?? "").trim()
    operation.run(() => createExposureAgentAction({
      code: form.get("code"),
      name: form.get("name"),
      agentType: form.get("agentType"),
      unit: form.get("unit"),
      permissibleLimit: limit ? Number(limit) : null,
      actionLevelFactor: Number(form.get("actionLevelFactor")),
      limitBasis: form.get("limitBasis"),
      surveillanceProtocol: String(form.get("surveillanceProtocol") ?? "") || null,
    }), () => setOpen(false))
  }

  // El diálogo sigue montado tras crear: parte de cero al abrir.
  return (
    <Dialog open={open} onOpenChange={(value) => { if (value) setAgentType(Object.keys(AGENT_TYPE_LABELS)[0] ?? "physical"); setOpen(value) }}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Nuevo agente</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nuevo agente de exposición</DialogTitle>
            <DialogDescription>
              Sin límite declarado, toda medición del agente se reporta «no comparable», nunca «cumple».
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Código"><Input name="code" required minLength={2} maxLength={60} placeholder="SIO2-CRIST" /></Field>
            <Field label="Tipo">
              <Select value={agentType} onValueChange={setAgentType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(AGENT_TYPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><input type="hidden" name="agentType" value={agentType} />
            </Field>
          </div>
          <Field label="Nombre"><Input name="name" required minLength={3} maxLength={200} placeholder="Sílice cristalina respirable" /></Field>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Límite permisible" hint="Opcional. Vacío = no comparable.">
              <Input name="permissibleLimit" type="number" step="any" min={0} />
            </Field>
            <Field label="Unidad"><Input name="unit" required maxLength={40} placeholder="mg/m³" /></Field>
            <Field label="Factor nivel de acción" hint="0-1. Ej: 0.5 = 50% del límite.">
              <Input name="actionLevelFactor" type="number" step="any" min={0.01} max={1} defaultValue={0.5} required />
            </Field>
          </div>
          <Field label="Fundamento del límite" hint="Mínimo 5 caracteres. Norma o protocolo de origen.">
            <Textarea name="limitBasis" required minLength={5} maxLength={2000} placeholder="DS 594/1999, art. 66" />
          </Field>
          <Field label="Protocolo de vigilancia" hint="Opcional."><Input name="surveillanceProtocol" maxLength={200} /></Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Crear agente</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Alta de GES ──────────────────────────────────────────────────────────── */

export function NewGroupDialog({ agents, worksites }: { agents: AgentOption[]; worksites: { id: string; name: string }[] }) {
  const [open, setOpen] = React.useState(false)
  const [worksiteId, setWorksiteId] = React.useState(worksites[0]?.id ?? "")
  const [agentId, setAgentId] = React.useState(agents[0]?.id ?? "")
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const riskEntryId = String(form.get("riskEntryId") ?? "").trim()
    operation.run(() => createExposureGroupAction({
      code: form.get("code"),
      name: form.get("name"),
      worksiteId: form.get("worksiteId"),
      agentId: form.get("agentId"),
      processDescription: form.get("processDescription"),
      riskEntryId: riskEntryId || null,
    }), () => setOpen(false))
  }

  // El diálogo sigue montado tras crear: parte de cero al abrir.
  return (
    <Dialog open={open} onOpenChange={(value) => {
      if (value) {
        setWorksiteId(worksites[0]?.id ?? "")
        setAgentId(agents[0]?.id ?? "")
      }
      setOpen(value)
    }}>
      <DialogTrigger asChild><Button size="sm">Nuevo grupo de exposición</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nuevo grupo de exposición similar</DialogTitle>
            <DialogDescription>Reúne a quienes comparten agente, proceso y condiciones, de modo que una medición represente a todo el grupo.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Código"><Input name="code" required minLength={2} maxLength={60} placeholder="GES-CHANC-01" /></Field>
            <Field label="Faena">
              <Select value={worksiteId} onValueChange={setWorksiteId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><input type="hidden" name="worksiteId" value={worksiteId} />
            </Field>
          </div>
          <Field label="Nombre"><Input name="name" required minLength={3} maxLength={200} placeholder="Operadores de chancado" /></Field>
          <Field label="Agente de exposición">
            <Select value={agentId} onValueChange={setAgentId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{agents.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} ({item.unit})</SelectItem>)}</SelectContent></Select><input type="hidden" name="agentId" value={agentId} />
          </Field>
          <Field label="Descripción del proceso" hint="Mínimo 10 caracteres.">
            <Textarea name="processDescription" required minLength={10} maxLength={3000} />
          </Field>
          <Field label="Peligro MIPER de origen" hint="Opcional.">
            <Input name="riskEntryId" placeholder="ID del peligro en la MIPER" />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Crear grupo</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Alta de programa de vigilancia ───────────────────────────────────────── */

export function NewProgramDialog({ agents, worksites }: { agents: AgentOption[]; worksites: { id: string; name: string }[] }) {
  const [open, setOpen] = React.useState(false)
  const [worksiteId, setWorksiteId] = React.useState(worksites[0]?.id ?? "")
  const [agentId, setAgentId] = React.useState("_none")
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const agentId = String(form.get("agentId") ?? "").trim()
    operation.run(() => createSurveillanceProgramAction({
      code: form.get("code"),
      name: form.get("name"),
      protocol: form.get("protocol"),
      agentId: agentId || null,
      worksiteId: form.get("worksiteId"),
      periodicityMonths: Number(form.get("periodicityMonths")),
      legalBasis: form.get("legalBasis"),
    }), () => setOpen(false))
  }

  // El diálogo sigue montado tras crear: parte de cero al abrir.
  return (
    <Dialog open={open} onOpenChange={(value) => {
      if (value) {
        setWorksiteId(worksites[0]?.id ?? "")
        setAgentId("_none")
      }
      setOpen(value)
    }}>
      <DialogTrigger asChild><Button size="sm">Nuevo programa de vigilancia</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nuevo programa de vigilancia</DialogTitle>
            <DialogDescription>Matricular un grupo deriva su nómina completa desde el GES: no se arma a mano.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Código"><Input name="code" required minLength={2} maxLength={60} placeholder="VIG-SILICE-01" /></Field>
            <Field label="Faena">
              <Select value={worksiteId} onValueChange={setWorksiteId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><input type="hidden" name="worksiteId" value={worksiteId} />
            </Field>
          </div>
          <Field label="Nombre"><Input name="name" required minLength={3} maxLength={200} /></Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Protocolo" hint="Ej: PREXOR, CEAL-SM, vigilancia sílice."><Input name="protocol" required minLength={2} maxLength={120} /></Field>
            <Field label="Agente asociado" hint="Opcional.">
              <Select value={agentId} onValueChange={setAgentId}><SelectTrigger><SelectValue placeholder="Sin agente específico" /></SelectTrigger><SelectContent><SelectItem value="_none">Sin agente específico</SelectItem>{agents.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><input type="hidden" name="agentId" value={agentId === "_none" ? "" : agentId} />
            </Field>
          </div>
          <Field label="Periodicidad (meses)"><Input name="periodicityMonths" type="number" min={1} max={120} defaultValue={12} required /></Field>
          <Field label="Fundamento normativo" hint="Mínimo 5 caracteres.">
            <Textarea name="legalBasis" required minLength={5} maxLength={2000} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Crear programa</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
