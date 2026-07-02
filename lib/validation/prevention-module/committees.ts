import { z } from "zod"

export const committeeCreateSchema = z.object({
  worksiteId: z.string().min(1, "Faena requerida"),
  type:       z.string().trim().min(1).max(40),
})

export const committeeMemberAddSchema = z.object({
  committeeId: z.string().min(1, "Comité requerido"),
  userId:      z.string().min(1, "Usuario requerido"),
  role:        z.string().trim().min(1).max(60),
  startDate:   z.string().min(1, "Fecha requerida"),
})

export const committeeMeetingScheduleSchema = z.object({
  committeeId:  z.string().min(1, "Comité requerido"),
  scheduledAt:  z.string().min(1, "Fecha requerida"),
  agenda:       z.string().trim().min(1).max(2000),
  attendeeIds:  z.array(z.string().min(1)).default([]),
})

export const committeeAgreementAddSchema = z.object({
  meetingId:     z.string().min(1, "Reunión requerida"),
  description:   z.string().trim().min(1).max(1000),
  responsibleId: z.string().min(1, "Responsable requerido"),
  dueDate:       z.string().min(1, "Plazo requerido"),
})
