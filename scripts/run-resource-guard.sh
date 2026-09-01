#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -eq 0 ]]; then
  echo "Usage: bash scripts/run-resource-guard.sh <command> [args...]" >&2
  exit 64
fi

# CI jobs have their own isolated runners and resource policy. Locally, a
# nested npm script inherits this marker so orchestration commands (for
# example Playwright -> npm run build) do not deadlock on their own lock.
if [[ -n "${CI:-}" || "${BODEGA_RESOURCE_GUARD:-1}" == "0" || "${BODEGA_RESOURCE_GUARD_ACTIVE:-}" == "1" ]]; then
  exec "$@"
fi

# The default lock is per Unix user, not per checkout. This also prevents two
# agents/worktrees for this project from running expensive validation together.
runtime_base="${XDG_RUNTIME_DIR:-/tmp}"
if [[ ! -d "$runtime_base" || ! -w "$runtime_base" ]]; then
  runtime_base="/tmp"
fi
lock_dir="${BODEGA_RESOURCE_LOCK_DIR:-${runtime_base}/bodega-resource-guard-${UID}}"
mkdir -p "$lock_dir"

exec 9>"${lock_dir}/heavy-task.lock"
if ! flock -n 9; then
  echo "[resource-guard] Otra tarea pesada está activa; esperando para no saturar el servidor..." >&2
  flock 9
fi

max_workers="${BODEGA_MAX_WORKERS:-3}"
heap_mb="${BODEGA_NODE_HEAP_MB:-4096}"
nice_level="${BODEGA_NICE_LEVEL:-10}"
oom_score_adj="${BODEGA_OOM_SCORE_ADJ:-500}"

if [[ ! "$max_workers" =~ ^[1-9][0-9]*$ ]]; then
  echo "BODEGA_MAX_WORKERS must be a positive integer." >&2
  exit 64
fi
if [[ ! "$heap_mb" =~ ^[1-9][0-9]*$ ]]; then
  echo "BODEGA_NODE_HEAP_MB must be a positive integer." >&2
  exit 64
fi
if [[ ! "$nice_level" =~ ^([0-9]|1[0-9])$ ]]; then
  echo "BODEGA_NICE_LEVEL must be an integer between 0 and 19." >&2
  exit 64
fi
if [[ ! "$oom_score_adj" =~ ^([0-9]|[1-9][0-9]{1,2}|1000)$ ]]; then
  echo "BODEGA_OOM_SCORE_ADJ must be an integer between 0 and 1000." >&2
  exit 64
fi

export BODEGA_RESOURCE_GUARD_ACTIVE=1
export BODEGA_BUILD_WORKERS="${BODEGA_BUILD_WORKERS:-$max_workers}"
export VITEST_MAX_WORKERS="${VITEST_MAX_WORKERS:-$max_workers}"
export PLAYWRIGHT_WORKERS="${PLAYWRIGHT_WORKERS:-1}"

# Preserve caller-provided Node flags. Add a conservative heap ceiling only
# when the caller did not choose one explicitly.
if [[ "${NODE_OPTIONS:-}" != *"--max-old-space-size="* \
  && "${NODE_OPTIONS:-}" != *"--max-old-space-size "* \
  && "${NODE_OPTIONS:-}" != *"--max_old_space_size="* \
  && "${NODE_OPTIONS:-}" != *"--max_old_space_size "* ]]; then
  export NODE_OPTIONS="${NODE_OPTIONS:+${NODE_OPTIONS} }--max-old-space-size=${heap_mb}"
fi

# Positive oom_score_adj values are permitted for an unprivileged process and
# inherited by children. Under genuine memory pressure, a test/build should be
# reclaimed before sshd or the database.
if [[ -w /proc/self/oom_score_adj ]]; then
  printf '%s\n' "$oom_score_adj" > /proc/self/oom_score_adj 2>/dev/null || true
fi

command=("$@")
if command -v ionice >/dev/null 2>&1; then
  command=(ionice -c 2 -n 7 "${command[@]}")
fi
if command -v nice >/dev/null 2>&1; then
  command=(nice -n "$nice_level" "${command[@]}")
fi

echo "[resource-guard] workers=${max_workers} browser=${PLAYWRIGHT_WORKERS} heap=${heap_mb}MiB nice=${nice_level}; lock=active" >&2
exec "${command[@]}"
