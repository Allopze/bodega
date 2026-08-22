#!/usr/bin/env node
/**
 * Small internal cron client. It owns the transport boundary so crontab never
 * invokes wget with a bearer token in a command/log line.
 */

import { fileURLToPath } from "node:url"
import path from "node:path"

const MAX_RESPONSE_BYTES = 32 * 1024

// `codePrefix` por job (no uno global): los crons de Combustibles usan su
// propio contrato (FUEL_CRON_*, lib/combustibles/fuel-cron-contract.ts) y no
// deben fingir ser jobs DTE para que el runner los acepte.
const JOBS = Object.freeze({
  dte: {
    url: "http://app:3000/api/cron/dte-portal-sync",
    timeoutMs: 5 * 60 * 1_000,
    kind: "sync",
    codePrefix: "DTE_CRON_",
  },
  sales: {
    url: "http://app:3000/api/cron/billing-sales-sync",
    timeoutMs: 5 * 60 * 1_000,
    kind: "sync",
    codePrefix: "DTE_CRON_",
  },
  chipax: {
    url: "http://app:3000/api/cron/chipax-sync",
    timeoutMs: 10 * 60 * 1_000,
    kind: "sync",
    codePrefix: "DTE_CRON_",
  },
  health: {
    url: "http://app:3000/api/cron/dte-sync-health",
    timeoutMs: 20 * 1_000,
    kind: "health",
    codePrefix: "DTE_HEALTH_",
  },
  "fuel-anomaly-detection": {
    url: "http://app:3000/api/cron/fuel-anomaly-detection",
    timeoutMs: 5 * 60 * 1_000,
    kind: "sync",
    codePrefix: "FUEL_CRON_",
  },
  "fuel-copec-sync": {
    url: "http://app:3000/api/cron/fuel-copec-sync",
    timeoutMs: 5 * 60 * 1_000,
    kind: "sync",
    codePrefix: "FUEL_CRON_",
  },
  "fuel-statement-notifications": {
    url: "http://app:3000/api/cron/fuel-statement-notifications",
    timeoutMs: 5 * 60 * 1_000,
    kind: "sync",
    codePrefix: "FUEL_CRON_",
  },
})

// Mapa de sufijos: cada job combina esto con su propio `codePrefix`, así que
// dos contratos distintos (DTE_CRON_SUCCESS, FUEL_CRON_SUCCESS) comparten la
// misma tabla de exit codes sin que el runner tenga que conocer el prefijo.
const SYNC_OUTCOME_SUFFIXES = new Map([
  ["success", { status: 200, exitCode: 0, ok: true, suffix: "SUCCESS" }],
  ["disabled", { status: 200, exitCode: 0, ok: true, suffix: "DISABLED" }],
  ["conflict", { status: 409, exitCode: 2, ok: false, suffix: "ACTIVE_RUN" }],
  ["partial", { status: 503, exitCode: 1, ok: false, suffix: "PARTIAL" }],
  ["failed", { status: 503, exitCode: 1, ok: false, suffix: "FAILED" }],
  ["unauthorized", { status: 401, exitCode: 1, ok: false, suffix: "UNAUTHORIZED" }],
])

const HEALTH_OUTCOMES = new Map([
  ["healthy", "DTE_HEALTH_OK"],
  ["disabled", "DTE_HEALTH_DISABLED"],
  ["degraded", "DTE_HEALTH_DEGRADED"],
  ["critical", "DTE_HEALTH_CRITICAL"],
])

export async function runCronJob(jobName, options = {}) {
  const job = JOBS[jobName]
  const secret = options.secret ?? process.env.CRON_SECRET
  const fetchImpl = options.fetchImpl ?? fetch
  const log = options.log ?? console.info

  if (!job || !secret) {
    log(JSON.stringify({ job: jobName, code: "DTE_CRON_RUNNER_CONFIGURATION", exitCode: 1 }))
    return 1
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), job.timeoutMs)
  try {
    const response = await fetchImpl(job.url, {
      method: "GET",
      headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" },
      redirect: "manual",
      signal: controller.signal,
    })
    const body = await readBoundedBody(response, MAX_RESPONSE_BYTES)
    const payload = parseJsonContract(body, job.kind, job.codePrefix)
    const exitCode = job.kind === "health"
      ? healthExitCode(response.status, payload)
      : syncExitCode(response.status, payload, job.codePrefix)
    log(JSON.stringify({
      job: jobName,
      status: response.status,
      outcome: payload.outcome,
      code: payload.code,
      exitCode,
    }))
    return exitCode
  } catch (error) {
    const code = error instanceof RunnerContractError
      ? error.code
      : error instanceof DOMException && error.name === "AbortError"
        ? "DTE_CRON_RUNNER_TIMEOUT"
        : "DTE_CRON_RUNNER_TRANSPORT"
    log(JSON.stringify({ job: jobName, code, exitCode: 1 }))
    return 1
  } finally {
    clearTimeout(timer)
  }
}

function syncExitCode(status, payload, codePrefix) {
  const expected = SYNC_OUTCOME_SUFFIXES.get(payload.outcome)
  if (
    !expected ||
    expected.status !== status ||
    payload.ok !== expected.ok ||
    payload.code !== `${codePrefix}${expected.suffix}`
  ) {
    throw new RunnerContractError("DTE_CRON_RUNNER_CONTRACT")
  }
  return expected.exitCode
}

function healthExitCode(status, payload) {
  const expectedCode = HEALTH_OUTCOMES.get(payload.status)
  if (
    status !== 200 ||
    payload.ok !== true ||
    typeof payload.status !== "string" ||
    payload.outcome !== payload.status ||
    !expectedCode ||
    payload.code !== expectedCode
  ) {
    throw new RunnerContractError("DTE_CRON_RUNNER_CONTRACT")
  }
  // A degraded data state is alertable but must not cause Docker to restart a
  // live scheduler. Only transport/auth/schema failure returns non-zero here.
  return 0
}

function parseJsonContract(body, kind, codePrefix) {
  let payload
  try {
    payload = JSON.parse(body)
  } catch {
    throw new RunnerContractError("DTE_CRON_RUNNER_INVALID_JSON")
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || typeof payload.outcome !== "string" || typeof payload.code !== "string") {
    throw new RunnerContractError("DTE_CRON_RUNNER_CONTRACT")
  }
  // Prefijo por job, no un `DTE_CRON_` fijo: los crons de Combustibles usan su
  // propio contrato y no deben fingir ser jobs DTE para que esto los acepte.
  if (kind === "sync" && !payload.code.startsWith(codePrefix)) {
    throw new RunnerContractError("DTE_CRON_RUNNER_CONTRACT")
  }
  return payload
}

async function readBoundedBody(response, limit) {
  if (!response.body) return ""
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new RunnerContractError("DTE_CRON_RUNNER_BODY_TOO_LARGE")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return new TextDecoder().decode(concatChunks(chunks, size))
}

function concatChunks(chunks, size) {
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

class RunnerContractError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

async function main() {
  const job = process.argv[2]
  const exitCode = await runCronJob(job)
  process.exitCode = exitCode
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main()
}
