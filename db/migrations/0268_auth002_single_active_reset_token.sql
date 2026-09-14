-- AUTH-002 (auditoría 2026-09-14): una sola credencial de recuperación vigente
-- por persona, garantizada por la base y no por el orden de dos escrituras.
--
-- Las filas históricas pueden violar la regla (dos tokens sin usar del mismo
-- usuario, dejados por una carrera). Se cierran las más antiguas antes de crear
-- el índice: son enlaces que la emisión siguiente habría invalidado igual.
UPDATE password_reset_tokens t
SET used_at = now()
WHERE t.used_at IS NULL
  AND EXISTS (
    SELECT 1 FROM password_reset_tokens n
    WHERE n.user_id = t.user_id
      AND n.used_at IS NULL
      AND (n.created_at, n.id) > (t.created_at, t.id)
  );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_one_active_per_user"
  ON "password_reset_tokens" ("user_id") WHERE "used_at" IS NULL;
