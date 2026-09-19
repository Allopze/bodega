"use client"

import { PdtpActivityCreator, type PdtpActivityCreatorProps } from "@/components/prevention/pdtp-activity-creator"

export function GuidedActivityForm(props: Omit<PdtpActivityCreatorProps, "mode">) {
  return <PdtpActivityCreator {...props} mode="annual_add" />
}
