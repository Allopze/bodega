import type { pdtpActivities, pdtpActivitySchedule } from "@/db/schema"

/** Filas del programa compartidas por los tabs del editor. */
export type PdtpActivityRow = typeof pdtpActivities.$inferSelect
export type PdtpScheduleRow = typeof pdtpActivitySchedule.$inferSelect
