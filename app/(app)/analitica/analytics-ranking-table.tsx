import type { ReactNode } from "react"
import { Table, TableBody, TableCell, TableCellNum, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MetaBadge } from "@/components/states/state-badge"
import { ChartEmpty } from "@/components/ui/chart-empty"
import type { AnalyticsAlertSeverity } from "@/lib/services/analytics"

export function RankingTable({
  title,
  headers,
  rows,
  empty,
}: {
  title: string
  headers: string[]
  rows: ReactNode[][]
  empty: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length > 0 ? (
          <TableRoot stickyHeader className="shadow-none">
            <Table>
              <TableHeader>
                <TableRow>
                  {headers.map((header, index) => (
                    <TableHead key={header} className={index === headers.length - 1 ? "text-right" : undefined}>{header}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice(0, 8).map((row, rowIndex) => (
                  <TableRow key={`${title}-${rowIndex}`}>
                    {row.map((cell, cellIndex) => {
                      const isLast = cellIndex === row.length - 1
                      const Cell = isLast ? TableCellNum : TableCell
                      return <Cell key={cellIndex}>{cell}</Cell>
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableRoot>
        ) : (
          <EmptyText text={empty} />
        )}
      </CardContent>
    </Card>
  )
}

export function SeverityBadge({ severity }: { severity: AnalyticsAlertSeverity }) {
  if (severity === "critical") return <MetaBadge meta={{ label: "Crítica", variant: "signal" }} dot />
  if (severity === "high") return <MetaBadge meta={{ label: "Alta", variant: "warning" }} dot />
  if (severity === "medium") return <MetaBadge meta={{ label: "Media", variant: "default" }} />
  return <MetaBadge meta={{ label: "Baja", variant: "outline" }} />
}

export function EmptyText({ text }: { text: string }) {
  return <ChartEmpty label={text} className="h-auto rounded-[var(--radius-lg)] py-8" />
}
