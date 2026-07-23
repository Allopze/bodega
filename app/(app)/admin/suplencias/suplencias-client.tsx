"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { formatDate } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  createTemporarySubstituteAction,
  extendTemporarySubstituteAction,
  revokeTemporarySubstituteAction,
} from "./actions"
import type { users } from "@/db/schema"

interface ActiveUser {
  id: string
  name: string
  email: string
}

interface SubstitutionRow {
  user: typeof users.$inferSelect
  substituteForName: string
}

interface SuplenciasClientProps {
  activeUsers: ActiveUser[]
  substitutions: SubstitutionRow[]
}

export function SuplenciasClient({ activeUsers, substitutions }: SuplenciasClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Modal state
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [selectedTitularId, setSelectedTitularId] = useState("")
  const [subName, setSubName] = useState("")
  const [subEmail, setSubEmail] = useState("")
  const [validDays, setValidDays] = useState(30)

  const handleCreate = () => {
    if (!selectedTitularId || !subName.trim() || !subEmail.trim()) {
      setError("Completa todos los campos obligatorios.")
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await createTemporarySubstituteAction({
        substituteForUserId: selectedTitularId,
        name: subName,
        email: subEmail,
        validUntilDays: Number(validDays),
      })
      if (res.ok) {
        setIsCreateOpen(false)
        setSelectedTitularId("")
        setSubName("")
        setSubEmail("")
        router.refresh()
      } else {
        setError(res.message || "Error al crear la suplencia.")
      }
    })
  }

  const handleExtend = (userId: string, days: number) => {
    setError(null)
    startTransition(async () => {
      const res = await extendTemporarySubstituteAction({ userId, additionalDays: days })
      if (res.ok) {
        router.refresh()
      } else {
        setError(res.message || "Error al extender la suplencia.")
      }
    })
  }

  const handleRevoke = (userId: string) => {
    setError(null)
    startTransition(async () => {
      const res = await revokeTemporarySubstituteAction(userId)
      if (res.ok) {
        router.refresh()
      } else {
        setError(res.message || "Error al revocar la suplencia.")
      }
    })
  }

  const getStatusBadge = (user: typeof users.$inferSelect, nowMs: number) => {
    if (!user.isActive) return <Badge variant="danger">Revocada / Inactiva</Badge>
    if (!user.validUntil) return <Badge variant="outline">Sin límite</Badge>
    const validUntilDate = new Date(user.validUntil)
    const diffDays = Math.ceil((validUntilDate.getTime() - nowMs) / (1000 * 3600 * 24))
    if (diffDays <= 0) return <Badge variant="danger">Vencida</Badge>
    if (diffDays <= 5) return <Badge variant="warning">Vence en {diffDays} días</Badge>
    return <Badge variant="success">Vigente ({diffDays} días)</Badge>
  }

  const [nowMs] = useState(() => Date.now())

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cuentas Temporales de Suplencia (R7)"
        description="Gestión de suplencias temporales con herencia automática de roles y faenas del titular"
        actions={
          <Button onClick={() => setIsCreateOpen(true)} className="bg-[var(--color-primary)] text-white">
            + Nueva Suplencia
          </Button>
        }
      />

      {error && (
        <div className="p-3 text-sm text-[var(--color-danger-ink)] bg-[var(--color-danger-tint)] rounded-md border border-[var(--color-danger-border)]">
          {error}
        </div>
      )}

      {substitutions.length === 0 ? (
        <EmptyState
          title="Sin suplencias temporales registradas"
          description="Crea una cuenta temporal para reemplazar a un usuario ausente durante un período acotado."
          action={
            <Button onClick={() => setIsCreateOpen(true)} className="bg-[var(--color-primary)] text-white">
              Crear Suplencia
            </Button>
          }
        />
      ) : (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-[var(--color-surface-2)] text-[var(--color-text-muted)] font-medium border-b border-[var(--color-border)]">
                <tr>
                  <th className="px-4 py-3">Suplente</th>
                  <th className="px-4 py-3">Reemplaza a (Titular)</th>
                  <th className="px-4 py-3">Vigencia hasta</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {substitutions.map(({ user, substituteForName }) => (
                  <tr key={user.id} className="hover:bg-[var(--color-surface-hover)]">
                    <td className="px-4 py-3">
                      <div className="font-medium text-[var(--color-text)]">{user.name}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">{user.email}</div>
                    </td>
                    <td className="px-4 py-3 font-medium text-[var(--color-text-muted)]">
                      {substituteForName || user.substituteForUserId || "—"}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">
                      {user.validUntil ? formatDate(user.validUntil) : "—"}
                    </td>
                    <td className="px-4 py-3">{getStatusBadge(user, nowMs)}</td>
                    <td className="px-4 py-3 text-right space-x-2">
                      {user.isActive && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleExtend(user.id, 15)}
                            disabled={isPending}
                          >
                            +15 días
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="text-[var(--color-danger-ink)] hover:bg-[var(--color-danger-tint)]"
                            onClick={() => handleRevoke(user.id)}
                            disabled={isPending}
                          >
                            Revocar
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Nueva Suplencia */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Crear Cuenta Temporal de Suplencia</DialogTitle>
            <DialogDescription>
              La cuenta temporal heredará automáticamente todos los roles y faenas del usuario titular a reemplazar (R7).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Usuario Titular a Reemplazar</Label>
              <Select value={selectedTitularId} onValueChange={setSelectedTitularId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona el usuario ausente" />
                </SelectTrigger>
                <SelectContent>
                  {activeUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name} ({u.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Nombre Completo del Suplente</Label>
              <Input
                placeholder="Ej: Juan Pérez (Reemplazo)"
                value={subName}
                onChange={(e) => setSubName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Correo Electrónico del Suplente</Label>
              <Input
                type="email"
                placeholder="suplente@empresa.cl"
                value={subEmail}
                onChange={(e) => setSubEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Vigencia Inicial (Días)</Label>
              <Select value={String(validDays)} onValueChange={(val) => setValidDays(Number(val))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">7 días (1 semana)</SelectItem>
                  <SelectItem value="15">15 días (quincena)</SelectItem>
                  <SelectItem value="30">30 días (1 mes)</SelectItem>
                  <SelectItem value="60">60 días (2 meses)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setIsCreateOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={isPending}>
              {isPending ? "Creando..." : "Crear Suplencia"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
