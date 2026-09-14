-- CAPA-002 (auditoría 2026-09-14): quien abría la acción correctiva podía
-- apagar el gate de evidencia (`evidence_required = false`) en el mismo
-- formulario de creación, sin dejar constancia del porqué. La acción recorría
-- implementación, verificación y cierre sin una sola evidencia y nada en la
-- fila explicaba la exención.
--
-- La columna guarda esa justificación y el CHECK la vuelve obligatoria: si no
-- se exige evidencia, hay que decir por qué (umbral único de
-- `lib/validation/reason-thresholds.ts`, 10 caracteres). Si se exige, el campo
-- tiene que estar vacío, para que nadie lo use como nota suelta.
ALTER TABLE prevention_capa_actions
  ADD COLUMN IF NOT EXISTS evidence_exemption_reason text;

-- Las exenciones anteriores a este control no tienen a quién preguntarle: se
-- marcan con su procedencia en vez de inventarles un motivo.
UPDATE prevention_capa_actions
   SET evidence_exemption_reason = 'Exención registrada antes de exigir justificación (CAPA-002).'
 WHERE evidence_required = false
   AND evidence_exemption_reason IS NULL;

ALTER TABLE prevention_capa_actions
  DROP CONSTRAINT IF EXISTS prevention_capa_evidence_exemption_justified;
ALTER TABLE prevention_capa_actions
  ADD CONSTRAINT prevention_capa_evidence_exemption_justified CHECK (
    (evidence_required = true AND evidence_exemption_reason IS NULL)
    OR (evidence_required = false AND evidence_exemption_reason IS NOT NULL
        AND length(btrim(evidence_exemption_reason)) >= 10)
  );
