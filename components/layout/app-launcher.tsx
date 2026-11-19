"use client"

import * as React from "react"
import Link from "next/link"
import type { Session } from "next-auth"
import { useQuery } from "@tanstack/react-query"
import { GridFour } from "@phosphor-icons/react"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { getLauncherApps, groupLauncherApps, type LauncherApp } from "@/lib/apps/launcher"
import { NAV_ICONS } from "./nav-icons"
import { canSeeNav } from "./nav-items"

async function fetchRecentAppIds(): Promise<string[]> {
  const response = await fetch("/api/apps/recientes")
  if (!response.ok) return []
  return ((await response.json()) as { appIds?: string[] }).appIds ?? []
}

function AppTile({ app, onNavigate }: { app: LauncherApp; onNavigate: () => void }) {
  const Icon = NAV_ICONS[app.iconName] ?? GridFour
  return (
    <Link
      href={app.href}
      onClick={onNavigate}
      className={cn(
        "flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-[var(--radius-lg)] px-1.5 py-2 text-center",
        "text-xs font-medium text-[var(--color-text)] hover:bg-(--color-chrome-hover)",
        "focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]",
        "transition-[background-color] duration-[var(--duration-fast)]",
      )}
    >
      <span className="flex size-9 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-surface-2)] text-[var(--color-primary)]">
        <Icon size={18} aria-hidden />
      </span>
      <span className="line-clamp-2 leading-tight">{app.label}</span>
    </Link>
  )
}

/**
 * Lanzador ⊞ de la barra superior: todas las apps que la persona puede abrir,
 * agrupadas por área, con las que abrió hace poco arriba. Es navegación; cada
 * página sigue validando su permiso en el servidor.
 */
export function AppLauncher({
  session,
  enabledModuleIds,
  disabledSubmoduleHrefs,
}: {
  session: Session
  enabledModuleIds?: Set<string>
  disabledSubmoduleHrefs?: Set<string>
}) {
  const [open, setOpen] = React.useState(false)
  const apps = React.useMemo(
    () => getLauncherApps(session, enabledModuleIds, disabledSubmoduleHrefs),
    [session, enabledModuleIds, disabledSubmoduleHrefs],
  )
  const groups = React.useMemo(() => groupLauncherApps(apps), [apps])
  // Se pide al acercarse al botón, no al montar: casi nadie abre el lanzador en
  // cada página, y al abrirlo las recientes ya están.
  const [wanted, setWanted] = React.useState(false)
  const want = React.useCallback(() => setWanted(true), [])
  const { data: recentIds = [] } = useQuery({
    queryKey: ["apps", "recientes"],
    queryFn: fetchRecentAppIds,
    enabled: wanted || open,
    staleTime: 60_000,
  })
  const recent = React.useMemo(() => {
    const byId = new Map(apps.map((app) => [app.id, app]))
    return recentIds.flatMap((id) => byId.get(id) ?? []).slice(0, 4)
  }, [apps, recentIds])
  const canSeeUsage = canSeeNav({ permissions: ["ti:view"] }, session) && (!enabledModuleIds || enabledModuleIds.has("ti"))
  const close = React.useCallback(() => setOpen(false), [])

  if (apps.length === 0) return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative hidden items-center justify-center sm:flex",
            "h-8 w-8 rounded-[var(--radius-lg)]",
            "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
            "hover:bg-(--color-chrome-hover)",
            "transition-[background-color,color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
          )}
          aria-label="Apps"
          title="Apps"
          onPointerEnter={want}
          onFocus={want}
        >
          <GridFour size={16} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[340px] p-0">
        <nav aria-label="Apps" className="max-h-[min(70vh,560px)] overflow-y-auto p-3">
          {recent.length > 0 && (
            <section aria-labelledby="apps-recientes" className="mb-2 border-b border-[var(--color-border)] pb-2">
              <h2 id="apps-recientes" className="text-eyebrow px-1.5 pb-1">Recientes</h2>
              <div className="grid grid-cols-4 gap-0.5">
                {recent.map((app) => <AppTile key={app.id} app={app} onNavigate={close} />)}
              </div>
            </section>
          )}
          {groups.map((group) => (
            <section key={group.areaId} aria-labelledby={`apps-${group.areaId}`} className="pt-1">
              <h2 id={`apps-${group.areaId}`} className="text-eyebrow px-1.5 pb-1">{group.areaLabel}</h2>
              <div className="grid grid-cols-4 gap-0.5">
                {group.apps.map((app) => <AppTile key={app.id} app={app} onNavigate={close} />)}
              </div>
            </section>
          ))}
        </nav>
        {canSeeUsage && (
          <div className="border-t border-[var(--color-border)] px-4 py-2.5">
            <Link href="/ti/apps" onClick={close} className="text-xs text-[var(--color-primary-ink)] hover:underline">
              Ver uso de las apps
            </Link>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
