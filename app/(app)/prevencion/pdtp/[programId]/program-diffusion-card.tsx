import Link from "next/link"
import { CaretDown, CheckCircle } from "@phosphor-icons/react/dist/ssr"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { formatDateTime } from "@/lib/utils"
import type { PdtpProgramDiffusionStatus } from "@/lib/services/pdtp/program-acknowledgments"

/**
 * Quién tomó conocimiento del programa y quién no: la difusión a gerencias
 * (N°2) y en cada faena (N°3). Es la vista de control de la jefatura de
 * prevención; el hecho lo registra `ProgramAcknowledgmentBeacon` cuando cada
 * persona abre el programa.
 *
 * Un padrón por bloque plegable: con seis faenas, las listas abiertas apiladas
 * sepultaban la planilla, y lo que se lee de un vistazo es el conteo.
 */
export function ProgramDiffusionCard({ status, canManageUsers }: { status: PdtpProgramDiffusionStatus; canManageUsers: boolean }) {
  if (status.groups.length === 0) return null
  const complete = status.groups.filter((group) => group.complete).length

  return (
    <section
      aria-labelledby="pdtp-diffusion-title"
      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
    >
      <h2 id="pdtp-diffusion-title" className="text-sm font-semibold text-[var(--color-text)]">
        Toma de conocimiento del programa
      </h2>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        {status.programActive
          ? "Queda registrada la primera vez que cada responsable abre esta versión del programa. Con el padrón completo se acredita la difusión (N°2 y N°3)."
          : "Se registra sólo sobre la versión activa: cuando esta versión se active, cada responsable tendrá que abrirla."}
        {" "}
        <span className="tabular-nums">{complete} de {status.groups.length}</span> padrones completos.
      </p>

      <ul className="mt-3 divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
        {status.groups.map((group) => {
          const total = group.people.length
          return (
            <li key={group.worksiteId ?? "gerencias"}>
              <details className="group/diffusion">
                <summary className="flex cursor-pointer list-none items-center gap-3 py-2.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] [&::-webkit-details-marker]:hidden">
                  <CaretDown size={14} className="shrink-0 text-[var(--color-text-subtle)] transition-transform group-open/diffusion:rotate-180" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[var(--color-text)]">{group.label}</span>
                    <span className="block text-xs text-[var(--color-text-subtle)]">
                      Actividad N°{group.activityNumber}
                      {!group.accredits && " · en esta versión no se acredita por toma de conocimiento"}
                    </span>
                  </span>
                  {total === 0 ? (
                    <Badge variant="warning">Sin responsables</Badge>
                  ) : group.complete ? (
                    <span className="flex items-center gap-1 text-sm text-[var(--color-success-ink)]">
                      <CheckCircle size={16} weight="fill" aria-hidden />
                      <span className="tabular-nums">{total} de {total}</span>
                    </span>
                  ) : (
                    <span className="text-sm tabular-nums text-[var(--color-text-muted)]">
                      {group.acknowledgedCount} de {total}
                    </span>
                  )}
                </summary>
                <div className="pb-3 pl-7">
                  {total === 0 ? (
                    <div className="space-y-2">
                      <p className="text-sm text-[var(--color-text-muted)]">
                        Nadie con un cargo responsable del programa está adscrito aquí, así que no hay a quién difundirle el plan. Adscribe a las personas y el padrón aparecerá solo.
                      </p>
                      {canManageUsers && (
                        <Button asChild size="sm" variant="secondary">
                          <Link href="/admin/usuarios">Adscribir responsables</Link>
                        </Button>
                      )}
                    </div>
                  ) : (
                    <>
                      <Progress
                        value={group.acknowledgedCount}
                        max={total}
                        label={`${group.acknowledgedCount} de ${total} tomaron conocimiento en ${group.label}`}
                        minVisible={2}
                      />
                      <ul className="mt-2 space-y-1.5">
                        {group.people.map((person) => (
                          <li key={person.userId} className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                            <span className="min-w-0">
                              <span className="text-[var(--color-text)]">{person.name}</span>
                              <span className="text-[var(--color-text-subtle)]"> · {person.roleLabels.join(", ")}</span>
                            </span>
                            {person.acknowledgedAt ? (
                              <span className="text-xs tabular-nums text-[var(--color-text-muted)]">
                                Lo vio el {formatDateTime(person.acknowledgedAt)}
                              </span>
                            ) : (
                              <Badge variant="neutral">Pendiente</Badge>
                            )}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              </details>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
