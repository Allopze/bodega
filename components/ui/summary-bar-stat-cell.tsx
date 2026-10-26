import * as React from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { Progress } from "./progress"
import type { SummaryLinkProps, SummaryStat } from "./summary-bar"
import { SUMMARY_TONE_TEXT, activeSummaryTone } from "./summary-bar-tone"

export function SummaryBarStatCell({ stat, renderLink, numerals = "mono" }: { stat: SummaryStat; renderLink?: (props: SummaryLinkProps) => React.ReactNode; numerals?: "mono" | "sans" }) {
  const isText = stat.valueKind === "text"
  const isZero = !isText && typeof stat.value === "number" && stat.value === 0
  const tone = activeSummaryTone(stat, { isText })
  const toneClass = tone ? SUMMARY_TONE_TEXT[tone] : null

  const body = (
    <div className="px-4 py-3">
      <div className="flex items-center gap-1.5">
        {stat.icon && <span className={cn(
          "shrink-0 transition-colors duration-[var(--duration-fast)]",
          toneClass ?? "text-[var(--color-text-faint)]",
          stat.href && "group-hover:text-[var(--color-primary)]",
        )}>{stat.icon}</span>}
        <span className={cn("text-eyebrow line-clamp-2 break-words transition-colors duration-[var(--duration-fast)]", stat.href && "group-hover:text-[var(--color-primary)]")}>{stat.label}</span>
      </div>
      <div className="mt-2 flex items-end gap-2">
        <span className={cn(
          isText ? "text-base font-semibold leading-snug" : cn(numerals === "sans" ? "font-sans" : "font-mono", "text-[1.375rem] font-semibold leading-none tabular-nums tracking-tight"),
          toneClass ?? (isZero ? "text-[var(--color-text-faint)]" : "text-[var(--color-text)]"),
        )}>{stat.value}</span>
        {stat.hint && <span className={cn(
          "mb-0.5 font-mono text-[11px] font-semibold tabular-nums",
          toneClass ?? "text-[var(--color-text-subtle)]",
        )}>{stat.hint}</span>}
        {typeof stat.progress === "number" && (
          <Progress value={stat.progress} label={stat.label} size="sm" className="mb-1.5 flex-1" />
        )}
      </div>
      {stat.secondary && <p className="mt-1 text-[11px] text-[var(--color-text-subtle)]">{stat.secondary}</p>}
    </div>
  )

  const cellClass = "group flex-1 min-w-[8.5rem] border-l border-t border-[var(--color-border)]"
  if (!stat.href) return <div className={cellClass}>{body}</div>
  const linkClass = cn(cellClass, "block hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]")
  if (renderLink) return <>{renderLink({ href: stat.href, className: linkClass, children: body, "data-pressable": "" })}</>
  return <Link href={stat.href} data-pressable className={linkClass}>{body}</Link>
}
