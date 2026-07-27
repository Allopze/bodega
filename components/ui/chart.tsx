"use client"

import * as React from "react"
import * as RechartsPrimitive from "recharts"
import { cn } from "@/lib/utils"

// Format: { [key in string]: { label?: ReactNode, icon?: ComponentType, color?: string, theme?: Record<string, string> } }
export type ChartConfig = Record<
  string,
  {
    label?: React.ReactNode
    icon?: React.ComponentType
    color?: string
    theme?: Record<string, string>
  }
>

interface ChartContextProps {
  config: ChartConfig
}

const ChartContext = React.createContext<ChartContextProps | null>(null)

export function useChart() {
  const context = React.useContext(ChartContext)
  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />")
  }
  return context
}

export const ChartContainer = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    config: ChartConfig
    children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"]
  }
>(({ id, className, children, config, ...props }, ref) => {
  const uniqueId = React.useId()
  const chartId = `chart-${id || uniqueId.replace(/:/g, "")}`

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-chart={chartId}
        ref={ref}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-[var(--color-text-muted)] [&_.recharts-cartesian-grid_line]:stroke-[var(--color-border)] [&_.recharts-curve.recharts-tooltip-cursor]:stroke-[var(--color-border-strong)] [&_.recharts-dot[aria-selected=true]]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-[var(--color-border)] [&_.recharts-radial-bar-background-sector]:fill-[var(--color-surface-2)] [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-[var(--color-surface-2)] [&_.recharts-reference-line_[stroke='#ccc']]:stroke-[var(--color-border-strong)] [&_.recharts-sector[aria-selected=true]]:outline-hidden [&_.recharts-sector]:outline-hidden [&_.recharts-surface]:outline-hidden",
          className
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer width="100%" height="100%">
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
})
ChartContainer.displayName = "ChartContainer"

const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
  const colorConfig = Object.entries(config).filter(
    ([, itemConfig]) => itemConfig.theme || itemConfig.color
  )

  if (!colorConfig.length) {
    return null
  }

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: Object.entries(config)
          .map(([key, itemConfig]) => {
            const color = itemConfig.color
            return color ? `[data-chart=${id}] { --color-${key}: ${color}; }` : ""
          })
          .join("\n"),
      }}
    />
  )
}

export const ChartTooltip = RechartsPrimitive.Tooltip

export interface ChartTooltipItem {
  dataKey?: string | number
  name?: string | number
  value?: unknown
  payload?: Record<string, unknown>
  color?: string
  fill?: string
}

export interface ChartTooltipContentProps extends React.ComponentProps<"div"> {
  active?: boolean
  payload?: ChartTooltipItem[]
  indicator?: "line" | "dot" | "dashed"
  hideLabel?: boolean
  hideIndicator?: boolean
  label?: unknown
  labelFormatter?: (label: unknown, payload: ChartTooltipItem[]) => React.ReactNode
  labelClassName?: string
  formatter?: (value: unknown, name: unknown, item: ChartTooltipItem, index: number, payload: unknown) => React.ReactNode
  color?: string
  nameKey?: string
  labelKey?: string
}

export const ChartTooltipContent = React.forwardRef<
  HTMLDivElement,
  ChartTooltipContentProps
>(
  (
    {
      active,
      payload,
      className,
      indicator = "dot",
      hideLabel = false,
      hideIndicator = false,
      label,
      labelFormatter,
      labelClassName,
      formatter,
      color,
      nameKey,
      labelKey,
    },
    ref
  ) => {
    const { config } = useChart()

    const tooltipLabel = React.useMemo(() => {
      if (hideLabel || !payload?.length) {
        return null
      }

      const [item] = payload
      const key = `${labelKey || item?.dataKey || item?.name || "value"}`
      const itemConfig = getPayloadConfigFromPayload(config, item, key)
      const value =
        !labelKey && typeof label === "string"
          ? config[label]?.label || label
          : itemConfig?.label

      if (labelFormatter) {
        return (
          <div className={cn("font-semibold text-[var(--color-text)]", labelClassName)}>
            {labelFormatter(value, payload)}
          </div>
        )
      }

      if (!value) {
        return null
      }

      return <div className={cn("font-semibold text-[var(--color-text)]", labelClassName)}>{value as React.ReactNode}</div>
    }, [label, labelFormatter, payload, hideLabel, labelClassName, config, labelKey])

    if (!active || !payload?.length) {
      return null
    }

    const nestLabel = payload.length === 1 && indicator !== "dot"

    return (
      <div
        ref={ref}
        className={cn(
          "grid min-w-[8rem] items-start gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs shadow-md backdrop-blur-sm",
          className
        )}
      >
        {!nestLabel ? tooltipLabel : null}
        <div className="grid gap-1.5">
          {payload.map((item: ChartTooltipItem, index: number) => {
            const key = `${nameKey || item.name || item.dataKey || "value"}`
            const itemConfig = getPayloadConfigFromPayload(config, item, key)
            const indicatorColor = color || item.payload?.fill || item.color

            return (
              <div
                key={String(item.dataKey || index)}
                className={cn(
                  "flex w-full items-center gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-[var(--color-text-muted)]",
                  indicator === "dot" && "items-center"
                )}
              >
                {formatter && item?.value !== undefined && item.name ? (
                  formatter(item.value, item.name, item, index, item.payload)
                ) : (
                  <>
                    {!hideIndicator && (
                      <div
                        className={cn(
                          "shrink-0 rounded-[2px] border-[--color-border]",
                          {
                            "h-2.5 w-2.5 rounded-full": indicator === "dot",
                            "w-1 h-3": indicator === "line",
                            "w-0 border-1 border-dashed h-3": indicator === "dashed",
                          }
                        )}
                        style={
                          {
                            backgroundColor: String(indicatorColor || ""),
                            borderColor: String(indicatorColor || ""),
                          } as React.CSSProperties
                        }
                      />
                    )}
                    <div className="flex flex-1 justify-between gap-3 leading-none">
                      <span className="text-[var(--color-text-muted)]">
                        {itemConfig?.label || String(item.name || "")}
                      </span>
                      {item.value !== undefined && (
                        <span className="font-mono font-medium tabular-nums text-[var(--color-text)]">
                          {typeof item.value === "number" ? item.value.toLocaleString("es-CL") : String(item.value)}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }
)
ChartTooltipContent.displayName = "ChartTooltipContent"

export const ChartLegend = RechartsPrimitive.Legend

export interface ChartLegendItem {
  value?: unknown
  dataKey?: string | number
  color?: string
}

export interface ChartLegendContentProps extends React.ComponentProps<"div"> {
  payload?: ChartLegendItem[]
  verticalAlign?: "top" | "middle" | "bottom"
  hideIcon?: boolean
  nameKey?: string
}

export const ChartLegendContent = React.forwardRef<
  HTMLDivElement,
  ChartLegendContentProps
>(({ className, hideIcon = false, payload, verticalAlign = "bottom", nameKey }, ref) => {
  const { config } = useChart()

  if (!payload?.length) {
    return null
  }

  return (
    <div
      ref={ref}
      className={cn(
        "flex items-center justify-center gap-4 text-xs font-medium text-[var(--color-text-muted)]",
        verticalAlign === "top" ? "pb-3" : "pt-3",
        className
      )}
    >
      {payload.map((item: ChartLegendItem) => {
        const key = `${nameKey || item.dataKey || "value"}`
        const itemConfig = getPayloadConfigFromPayload(config, item, key)

        return (
          <div key={String(item.value || key)} className="flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3">
            {!hideIcon && (
              <div
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: item.color }}
              />
            )}
            <span>{itemConfig?.label || String(item.value || "")}</span>
          </div>
        )
      })}
    </div>
  )
})
ChartLegendContent.displayName = "ChartLegendContent"

function getPayloadConfigFromPayload(
  config: ChartConfig,
  payload: unknown,
  key: string
) {
  if (typeof payload !== "object" || payload === null) {
    return undefined
  }

  const payloadPayload =
    "payload" in payload &&
    typeof payload.payload === "object" &&
    payload.payload !== null
      ? payload.payload
      : undefined

  let configLabelKey: string = key

  if (
    key in payload &&
    typeof payload[key as keyof typeof payload] === "string"
  ) {
    configLabelKey = payload[key as keyof typeof payload] as string
  } else if (
    payloadPayload &&
    key in payloadPayload &&
    typeof payloadPayload[key as keyof typeof payloadPayload] === "string"
  ) {
    configLabelKey = payloadPayload[key as keyof typeof payloadPayload] as string
  }

  return configLabelKey in config
    ? config[configLabelKey]
    : config[key as keyof typeof config]
}
