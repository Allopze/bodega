-- Los tokens PPA son credenciales de capacidad. Se almacenan como SHA-256
-- para que una lectura de la base no permita reutilizar enlaces públicos.
-- PGlite no distribuye pgcrypto: la aplicación mantiene fallback de lectura
-- y hace el upgrade perezoso de enlaces históricos durante los tests locales.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
EXCEPTION
  WHEN feature_not_supported OR insufficient_privilege THEN
    RAISE NOTICE 'pgcrypto no disponible; los enlaces PPA históricos se actualizarán al primer uso.';
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regprocedure('digest(bytea,text)') IS NOT NULL THEN
    EXECUTE $backfill$
      UPDATE ppa_submissions
         SET public_token = encode(digest(public_token, 'sha256'), 'hex')
       WHERE public_token !~ '^[0-9a-f]{64}$'
    $backfill$;
  END IF;
END
$$;
