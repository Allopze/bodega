#!/usr/bin/env bash
#
# scripts/apply-pdtp-data.sh
#
# Aplica, en un solo comando, todo el dato que el PDTP necesita para que sus
# actividades acrediten: RBAC, taxonomía documental, decisiones de catálogo,
# cursos/planes/campañas, mecanismos, SLA de las actividades a demanda y el
# catálogo de instrumentos de inspección. Termina con el diagnóstico de
# cableado.
#
#   npm run pdtp:apply-all
#   PDTP_APPLY_DRY_RUN=true npm run pdtp:apply-all     # no escribe nada
#   PDTP_APPLY_SKIP_MIGRATE=true npm run pdtp:apply-all
#
# **En producción esto ya corre solo**: cada paso es una etapa de
# `scripts/deploy-prod.sh`, ejecutada como un one-shot de compose. Este script
# es el equivalente para desarrollo, donde hasta ahora había que acordarse de
# los ocho comandos y de su orden.
#
# Que sean dos listas es un riesgo conocido, y por eso
# `lib/__tests__/pdtp-data-steps-parity.test.ts` compara ésta con la del deploy
# y falla si alguien agrega un paso en un lado y no en el otro. Un paso que
# corre en dev y no en producción es exactamente cómo el catálogo de tipos
# documentales llegó vacío a producción durante meses.
#
# Idempotente de punta a punta: cada paso reconoce lo ya aplicado y no lo
# repite. Correrlo dos veces seguidas no cambia nada la segunda vez.

set -euo pipefail

# npm-script|servicio-compose-equivalente-en-produccion
PDTP_DATA_STEPS=(
  "db:sync-rbac|sync-rbac"
  "pdtp:apply-catalog-decisions|apply-pdtp-catalog-decisions"
  "pdtp:apply-worksite-scope|apply-pdtp-worksite-scope"
  "db:apply-sst-taxonomy|apply-sst-taxonomy"
  "db:seed-emergency-plans|seed-emergency-plans"
  "pdtp:apply-program-data|apply-pdtp-program-data"
  "pdtp:apply-mechanisms|apply-pdtp-mechanisms"
  "pdtp:apply-objectives|apply-pdtp-objectives"
  "pdtp:apply-demand-slas|apply-pdtp-demand-slas"
  "db:seed-pdtp-inspection-templates|seed-inspection-templates"
  "db:preflight-pdtp-wiring|preflight-pdtp-wiring"
  "pdtp:reconcile-fulfillment-events|reconcile-pdtp-fulfillment-events"
)

# Pasos que NO saben simular: no tienen modo de sólo lectura, así que en un
# dry run se omiten en vez de correrse igual. Decir "no escribe nada" y escribir
# de todos modos es peor que no ofrecer el dry run.
PDTP_STEPS_WITHOUT_DRY_RUN=(
  "db:sync-rbac"
  "pdtp:reconcile-fulfillment-events"
)

step_supports_dry_run() {
  local candidate="$1"
  for excluded in "${PDTP_STEPS_WITHOUT_DRY_RUN[@]}"; do
    [[ "${candidate}" == "${excluded}" ]] && return 1
  done
  return 0
}

if [[ "${PDTP_APPLY_DRY_RUN:-}" == "true" ]]; then
  # Cada script tiene su propia variable; se exportan todas para no obligar a
  # nadie a recordar cuál se llama cómo.
  export SEED_DRY_RUN=true
  export SST_TAXONOMY_DRY_RUN=true
  export PDTP_DECISIONS_DRY_RUN=true
  export PDTP_WORKSITE_SCOPE_DRY_RUN=true
  export PDTP_MECHANISMS_DRY_RUN=true
  export PDTP_OBJECTIVES_DRY_RUN=true
  export PDTP_PROGRAM_DATA_DRY_RUN=true
  export PDTP_DEMAND_SLAS_DRY_RUN=true
  export EMERGENCY_PLANS_DRY_RUN=true
  echo "▸ DRY RUN: ningún paso escribe en la base."
  echo "  Se omiten los que no saben simular: ${PDTP_STEPS_WITHOUT_DRY_RUN[*]}"
  echo ""
fi

if [[ "${PDTP_APPLY_SKIP_MIGRATE:-}" != "true" && "${PDTP_APPLY_DRY_RUN:-}" != "true" ]]; then
  # Las migraciones van primero por la misma razón que en el deploy: varios de
  # estos pasos escriben columnas que una base atrasada todavía no tiene.
  echo "▸ Migraciones"
  npm run --silent db:migrate
  echo ""
fi

failed=()
for step in "${PDTP_DATA_STEPS[@]}"; do
  script="${step%%|*}"
  if [[ "${PDTP_APPLY_DRY_RUN:-}" == "true" ]] && ! step_supports_dry_run "${script}"; then
    echo "▸ ${script} — omitido (no admite simulación)"
    echo ""
    continue
  fi
  echo "▸ ${script}"
  if npm run --silent "${script}"; then
    echo ""
  else
    # No se aborta la cadena: un paso que falla por falta de dato no debe
    # impedir que corran los siguientes, y el resumen final dice cuáles fueron.
    # Es el mismo criterio tolerante que el deploy aplica con DEPLOY_MODE.
    echo "  ✗ ${script} falló"
    echo ""
    failed+=("${script}")
  fi
done

if (( ${#failed[@]} > 0 )); then
  echo "Pasos con error: ${failed[*]}"
  exit 1
fi

echo "Todos los pasos aplicados."
