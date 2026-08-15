"use client"

import * as React from "react"
import { UsersFour } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/ui/empty-state"
import { useOperation } from "@/lib/hooks/use-operation"
import { assignCommissionMemberAction, createCommissionAction } from "../actions"

interface Commission {
  id: string
  name: string
  purpose: string
  memberCount: number
}

interface MemberOption {
  id: string
  name: string
}

/**
 * Comisiones de trabajo del comité (nivel Plata del manual de Mutual). Cada
 * comisión declara su propósito y agrupa integrantes activos; un integrante
 * puede estar en más de una.
 */
export function CommitteeCommissions({ committeeId, commissions, members, canManage }: {
  committeeId: string
  commissions: Commission[]
  members: MemberOption[]
  canManage: boolean
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Comisiones ({commissions.length})</h2>
        {commissions.length > 0 && canManage && <NewCommissionDialog committeeId={committeeId} />}
      </div>
      {commissions.length === 0 ? (
        <EmptyState
          icon={<UsersFour size={24} />}
          title="El comité aún no tiene comisiones"
          description="Crea una comisión con propósito definido para distribuir el trabajo permanente del comité."
          action={canManage ? <NewCommissionDialog committeeId={committeeId} /> : undefined}
          compact
        />
      ) : (
        <div className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
          {commissions.map((commission) => (
            <div key={commission.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <span className="text-sm font-medium">{commission.name}</span>
                <span className="block text-xs text-[var(--color-text-subtle)]">{commission.purpose}</span>
                <span className="block text-xs text-[var(--color-text-subtle)]">{commission.memberCount} integrante(s)</span>
              </div>
              {canManage && members.length > 0 && (
                <AssignMemberDialog commissionId={commission.id} commissionName={commission.name} members={members} />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function NewCommissionDialog({ committeeId }: { committeeId: string }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => createCommissionAction({
      committeeId,
      name: form.get("name"),
      purpose: form.get("purpose"),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Nueva comisión</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nueva comisión</DialogTitle>
            <DialogDescription>Buena práctica de nivel Plata: el comité se organiza por comisiones con propósito declarado.</DialogDescription>
          </DialogHeader>
          <Field label="Nombre" htmlFor="commission-name" hint="Mínimo 3 caracteres.">
            <Input id="commission-name" name="name" required minLength={3} maxLength={200} />
          </Field>
          <Field label="Propósito" htmlFor="commission-purpose" hint="Mínimo 10 caracteres.">
            <Textarea id="commission-purpose" name="purpose" required minLength={10} maxLength={2000} rows={3} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Crear</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AssignMemberDialog({ commissionId, commissionName, members }: {
  commissionId: string
  commissionName: string
  members: MemberOption[]
}) {
  const [open, setOpen] = React.useState(false)
  const [memberId, setMemberId] = React.useState("")
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    operation.run(() => assignCommissionMemberAction({ commissionId, memberId }), () => { setOpen(false); setMemberId("") })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" aria-label={`Asignar integrante a ${commissionName}`}>
          Asignar integrante
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Asignar integrante a {commissionName}</DialogTitle>
            <DialogDescription>Sólo integrantes activos del comité.</DialogDescription>
          </DialogHeader>
          <Field label="Integrante">
            <OptionSelect
              id="commission-member"
              value={memberId}
              onValueChange={setMemberId}
              placeholder="Selecciona integrante"
              options={members.map((member) => ({ value: member.id, label: member.name }))}
            />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending || !memberId}>Asignar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
