-- MIPER-01 · Saneamiento del vocabulario de nivel de riesgo antes de exigirlo.
--
-- La columna era texto libre al escribir y un enum inglés al leer, así que
-- convivían "Alto", "critico", "Medio", "moderate" y "high" para cuatro niveles.
-- Esto normaliza lo existente al vocabulario único de lib/prevention/risk-levels
-- (los mismos alias que acepta `riskLevelSchema`) y recién después agrega la
-- restricción. Si quedara alguna fila con un texto que no corresponde a ningún
-- nivel, el ADD CONSTRAINT falla a propósito: es un dato que nadie sabe leer y
-- hay que decidirlo a mano, no adivinarlo.
--
-- `translate` en vez de `unaccent()`: la extensión no está instalada y las
-- únicas tildes del vocabulario son las de "crítico".
UPDATE "prevention_risk_entries" SET "inherent_level" = CASE
  WHEN translate(lower(btrim("inherent_level")), 'áéíóúü', 'aeiouu') IN ('low', 'bajo', 'baja', 'leve', 'menor', 'insignificante', 'trivial', 'aceptable') THEN 'low'
  WHEN translate(lower(btrim("inherent_level")), 'áéíóúü', 'aeiouu') IN ('medium', 'medio', 'media', 'moderate', 'moderado', 'moderada', 'tolerable') THEN 'medium'
  WHEN translate(lower(btrim("inherent_level")), 'áéíóúü', 'aeiouu') IN ('high', 'alto', 'alta', 'importante', 'severo', 'grave') THEN 'high'
  WHEN translate(lower(btrim("inherent_level")), 'áéíóúü', 'aeiouu') IN ('critical', 'critico', 'critica', 'muy alto', 'muy alta', 'extremo', 'intolerable', 'inaceptable') THEN 'critical'
  ELSE "inherent_level"
END WHERE "inherent_level" NOT IN ('low', 'medium', 'high', 'critical');--> statement-breakpoint
UPDATE "prevention_risk_entries" SET "residual_level" = CASE
  WHEN translate(lower(btrim("residual_level")), 'áéíóúü', 'aeiouu') IN ('low', 'bajo', 'baja', 'leve', 'menor', 'insignificante', 'trivial', 'aceptable') THEN 'low'
  WHEN translate(lower(btrim("residual_level")), 'áéíóúü', 'aeiouu') IN ('medium', 'medio', 'media', 'moderate', 'moderado', 'moderada', 'tolerable') THEN 'medium'
  WHEN translate(lower(btrim("residual_level")), 'áéíóúü', 'aeiouu') IN ('high', 'alto', 'alta', 'importante', 'severo', 'grave') THEN 'high'
  WHEN translate(lower(btrim("residual_level")), 'áéíóúü', 'aeiouu') IN ('critical', 'critico', 'critica', 'muy alto', 'muy alta', 'extremo', 'intolerable', 'inaceptable') THEN 'critical'
  ELSE "residual_level"
END WHERE "residual_level" NOT IN ('low', 'medium', 'high', 'critical');--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_inherent_level_valid" CHECK ("prevention_risk_entries"."inherent_level" IN ('low', 'medium', 'high', 'critical'));--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_residual_level_valid" CHECK ("prevention_risk_entries"."residual_level" IN ('low', 'medium', 'high', 'critical'));
