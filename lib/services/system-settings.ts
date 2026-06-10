import { db } from "@/db"
import { systemSettings } from "@/db/schema"
import { eq } from "drizzle-orm"
import { recordAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"

export interface CompanyProfile {
  name:             string
  rut:              string
  businessActivity: string
  address:          string
  branchAddress:    string
  phone:            string
  email:            string
  website:          string
}

const DEFAULT_COMPANY_PROFILE: CompanyProfile = {
  name:             "Chome",
  rut:              "",
  businessActivity: "",
  address:          "",
  branchAddress:    "",
  phone:            "",
  email:            "",
  website:          "",
}

const COMPANY_PROFILE_KEYS = {
  name:             "company_name",
  rut:              "company_rut",
  businessActivity: "company_business_activity",
  address:          "company_address",
  branchAddress:    "company_branch_address",
  phone:            "company_phone",
  email:            "company_email",
  website:          "company_website",
} as const satisfies Record<keyof CompanyProfile, string>

/**
 * Get the configured maximum PDF file size upload limit in MB.
 * Defaults to 10 MB if not set or invalid.
 */
export async function getPdfMaxSizeMb(): Promise<number> {
  try {
    const setting = await db.query.systemSettings.findFirst({
      where: eq(systemSettings.key, "pdf_max_size_mb"),
    })
    if (setting) {
      const val = parseInt(setting.value, 10)
      if (!isNaN(val) && val > 0) {
        return val
      }
    }
  } catch (err) {
    logger.error("Error fetching pdf_max_size_mb setting, using default 10MB:", err)
  }
  return 10
}

/**
 * Get the configured company profile used in printable purchase orders.
 * Missing fields fall back to empty strings, while the company name defaults to Chome.
 */
export async function getCompanyProfile(): Promise<CompanyProfile> {
  try {
    const rows = await Promise.all(
      Object.values(COMPANY_PROFILE_KEYS).map((key) =>
        db.query.systemSettings.findFirst({
          where: eq(systemSettings.key, key),
        })
      )
    )

    const byKey = Object.fromEntries(
      rows
        .filter((row): row is { key: string; value: string; updatedAt: string } => !!row)
        .map((row) => [row.key, row.value])
    )

    return {
      name:             cleanSetting(byKey[COMPANY_PROFILE_KEYS.name]) || DEFAULT_COMPANY_PROFILE.name,
      rut:              cleanSetting(byKey[COMPANY_PROFILE_KEYS.rut]),
      businessActivity: cleanSetting(byKey[COMPANY_PROFILE_KEYS.businessActivity]),
      address:          cleanSetting(byKey[COMPANY_PROFILE_KEYS.address]),
      branchAddress:    cleanSetting(byKey[COMPANY_PROFILE_KEYS.branchAddress]),
      phone:            cleanSetting(byKey[COMPANY_PROFILE_KEYS.phone]),
      email:            cleanSetting(byKey[COMPANY_PROFILE_KEYS.email]),
      website:          cleanSetting(byKey[COMPANY_PROFILE_KEYS.website]),
    }
  } catch (err) {
    logger.error("Error fetching company profile settings, using defaults:", err)
    return DEFAULT_COMPANY_PROFILE
  }
}

/**
 * Set the maximum PDF file size upload limit in MB.
 * Updates the database and logs the action to the audit log.
 */
export async function setPdfMaxSizeMb(
  value: number,
  userId: string,
  userEmail?: string,
): Promise<void> {
  const oldValue = await getPdfMaxSizeMb()
  const valStr = value.toString()

  await db
    .insert(systemSettings)
    .values({
      key: "pdf_max_size_mb",
      value: valStr,
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: {
        value: valStr,
        updatedAt: new Date().toISOString(),
      },
    })

  recordAudit({
    userId,
    userEmail,
    action: "update",
    entityType: "system_setting",
    entityId: "pdf_max_size_mb",
    oldState: { value: oldValue },
    newState: { value },
  })
}

/**
 * Set the company profile used in printable purchase orders.
 */
export async function setCompanyProfile(
  profile: CompanyProfile,
  userId: string,
  userEmail?: string,
): Promise<void> {
  const oldValue = await getCompanyProfile()
  const normalized: CompanyProfile = {
    name:             cleanSetting(profile.name) || DEFAULT_COMPANY_PROFILE.name,
    rut:              cleanSetting(profile.rut),
    businessActivity: cleanSetting(profile.businessActivity),
    address:          cleanSetting(profile.address),
    branchAddress:    cleanSetting(profile.branchAddress),
    phone:            cleanSetting(profile.phone),
    email:            cleanSetting(profile.email),
    website:          cleanSetting(profile.website),
  }

  const now = new Date().toISOString()

  await Promise.all(
    (Object.keys(COMPANY_PROFILE_KEYS) as Array<keyof CompanyProfile>).map((field) =>
      db
        .insert(systemSettings)
        .values({
          key:       COMPANY_PROFILE_KEYS[field],
          value:     normalized[field],
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: {
            value:     normalized[field],
            updatedAt: now,
          },
        })
    )
  )

  recordAudit({
    userId,
    userEmail,
    action:     "update",
    entityType: "system_setting",
    entityId:   "company_profile",
    oldState:   { ...oldValue },
    newState:   { ...normalized },
  })
}

function cleanSetting(value: string | null | undefined): string {
  return (value ?? "").trim()
}
