"use client"

import { useState } from "react"
import Link from "next/link"
import { Plus, Warning } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog"

interface SolicitudesActionsProps {
  canCreate: boolean
  hasWorksites: boolean
}

export function SolicitudesActions({ canCreate, hasWorksites }: SolicitudesActionsProps) {
  const [showWarningModal, setShowWarningModal] = useState(false)

  if (!canCreate) return null

  const button = hasWorksites ? (
    <Button variant="primary" size="sm" asChild>
      <Link href="/solicitudes/nueva">
        <Plus weight="bold" size={16} />
        Nueva solicitud
      </Link>
    </Button>
  ) : (
    <Button variant="primary" size="sm" onClick={() => setShowWarningModal(true)}>
      <Plus weight="bold" size={16} />
      Nueva solicitud
    </Button>
  )

  return (
    <>
      {button}
      <Dialog open={showWarningModal} onOpenChange={setShowWarningModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="flex flex-col items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-warning-tint)] text-[var(--color-warning-ink)] mb-3">
              <Warning size={24} weight="bold" />
            </div>
            <DialogTitle>Sin faenas asignadas</DialogTitle>
            <DialogDescription className="mt-2 text-sm text-center">
              No tienes faenas activas asignadas a tu cuenta o no existen faenas en el sistema. Contacta a un administrador para que te asigne una faena antes de poder crear una solicitud.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-center">
            <DialogClose asChild>
              <Button type="button" variant="secondary" size="sm">
                Entendido
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
