"use client"

import * as React from "react"
import { DayPicker } from "react-day-picker"
import { es } from "date-fns/locale"
import { CalendarBlank, CaretLeft, CaretRight } from "@phosphor-icons/react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { formatDate } from "@/lib/utils"
import { parseLocalDate, localDateToISO } from "@/lib/sst/date"

// ─── Props ────────────────────────────────────────────────────────────────────

export interface DatePickerProps {
  /** ISO 'YYYY-MM-DD' string (controlled). */
  value?:       string
  /** Called with ISO 'YYYY-MM-DD' string on selection. */
  onChange?:    (iso: string) => void
  /** Default value for uncontrolled / FormData usage. */
  defaultValue?: string
  /** `name` attribute for the hidden input (FormData / server actions). */
  name?:        string
  id?:          string
  placeholder?: string
  disabled?:    boolean
  error?:       boolean
  /** ISO 'YYYY-MM-DD' — earliest selectable date. */
  min?:         string
  /** ISO 'YYYY-MM-DD' — latest selectable date. */
  max?:         string
  className?:   string
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DatePicker({
  value,
  onChange,
  defaultValue,
  name,
  id,
  placeholder = "Seleccionar fecha",
  disabled,
  error,
  min,
  max,
  className,
}: DatePickerProps) {
  // When uncontrolled (FormData usage), keep internal state
  const [internalValue, setInternalValue] = React.useState(defaultValue ?? "")
  const iso     = value !== undefined ? value : internalValue
  const setIso  = onChange ?? setInternalValue

  const [open, setOpen] = React.useState(false)

  // Convert ISO → Date for DayPicker (local timezone, no UTC shift)
  const selected: Date | undefined = iso ? parseLocalDate(iso) : undefined
  const fromDate: Date | undefined = min  ? parseLocalDate(min)  : undefined
  const toDate:   Date | undefined = max  ? parseLocalDate(max)  : undefined

  function handleSelect(date: Date | undefined) {
    if (!date) return
    setIso(localDateToISO(date))
    setOpen(false)
  }

  const displayLabel = iso ? formatDate(parseLocalDate(iso)) : ""

  return (
    <>
      {/* Hidden input for FormData / server actions */}
      {name && <input type="hidden" name={name} value={iso} />}

      <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            disabled={disabled}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label={displayLabel || placeholder}
            className={cn(
              // Match Input / SelectTrigger exactly
              "flex h-9 w-full items-center justify-between gap-2 rounded-(--radius-lg)",
              "border border-[var(--color-border-control)] bg-[var(--color-surface)]",
              "px-3.5 py-1.5 text-sm text-[var(--color-text)]",
              "transition-[border-color,box-shadow,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              "hover:border-[var(--color-border-control-hover)]",
              "focus-visible:outline-none focus-visible:border-[var(--color-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary-line)]",
              "disabled:cursor-not-allowed disabled:opacity-50",
              // Emil: press feedback
              "active:scale-[0.99]",
              !displayLabel && "text-[var(--color-text-subtle)]",
              error && "border-[var(--color-danger)] focus-visible:border-[var(--color-danger)] focus-visible:ring-[var(--color-danger-line)]",
              className,
            )}
          >
            <span className="truncate">{displayLabel || placeholder}</span>
            <CalendarBlank
              className="h-4 w-4 shrink-0 text-[var(--color-text-subtle)]"
              weight="regular"
            />
          </button>
        </PopoverTrigger>

        <PopoverContent
          className="w-auto p-0"
          align="start"
          // Prevent popover from stealing aria focus from trigger on open
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DayPicker
            mode="single"
            locale={es}
            selected={selected}
            onSelect={handleSelect}
            startMonth={fromDate}
            endMonth={toDate}
            disabled={[
              ...(fromDate ? [{ before: fromDate }] : []),
              ...(toDate   ? [{ after:  toDate   }] : []),
            ]}
            defaultMonth={selected ?? (fromDate ?? toDate)}
            showOutsideDays
            fixedWeeks
            classNames={{
              root:         "p-3 select-none",
              months:       "flex flex-col",
              month:        "space-y-3",
              month_caption: "flex items-center justify-between px-1",
              caption_label: "text-sm font-semibold text-[var(--color-text)] capitalize",
              nav:          "flex items-center gap-1",
              button_previous: cn(
                "h-7 w-7 flex items-center justify-center rounded-[var(--radius-sm)]",
                "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
                "transition-colors duration-[var(--duration-fast)]",
                "disabled:opacity-40 disabled:pointer-events-none",
              ),
              button_next: cn(
                "h-7 w-7 flex items-center justify-center rounded-[var(--radius-sm)]",
                "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
                "transition-colors duration-[var(--duration-fast)]",
                "disabled:opacity-40 disabled:pointer-events-none",
              ),
              month_grid:   "w-full border-collapse",
              weekdays:     "flex",
              weekday:      "w-10 text-center text-xs font-medium text-[var(--color-text-subtle)] py-1",
              week:         "flex mt-1",
              day:          "p-0",
              day_button: cn(
                // Emil: 40px cells, press scale, no scale(0) entrances
                "h-10 w-10 flex items-center justify-center text-sm rounded-[var(--radius-sm)]",
                "transition-[background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
                "hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
                "active:scale-[0.93]",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]",
              ),
              selected:     "!bg-[var(--color-primary)] !text-white rounded-[var(--radius-sm)]",
              today:        "font-semibold ring-1 ring-[var(--color-primary-line)] rounded-[var(--radius-sm)]",
              outside:      "opacity-35",
              disabled:     "opacity-35 pointer-events-none",
              hidden:       "invisible",
            }}
            components={{
              Chevron: ({ orientation }) =>
                orientation === "left"
                  ? <CaretLeft  className="h-3.5 w-3.5" weight="bold" />
                  : <CaretRight className="h-3.5 w-3.5" weight="bold" />,
            }}
          />
        </PopoverContent>
      </Popover>
    </>
  )
}
