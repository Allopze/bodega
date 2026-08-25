import type { Session } from "next-auth"
import { can } from "@/lib/auth/can"

type FeedbackOwner = { createdBy: string }

/** A support manager or global reader can read every support ticket. */
export function canViewAllFeedback(session: Session | null): boolean {
  return can(session, "feedback:view_all") || can(session, "feedback:manage")
}

/** Determines whether the user can open the support inbox at all. */
export function canAccessFeedbackIndex(session: Session | null): boolean {
  return can(session, "feedback:view_own") || canViewAllFeedback(session)
}

/** Determines whether the user can read a particular ticket or its attachments. */
export function canAccessFeedbackReport(session: Session | null, report: FeedbackOwner): boolean {
  return canViewAllFeedback(session)
    || (can(session, "feedback:view_own") && report.createdBy === session?.user.id)
}
