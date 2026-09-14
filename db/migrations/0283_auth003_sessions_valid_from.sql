-- AUTH-003 (auditoría 2026-09-14): restablecer la contraseña no cerraba las
-- sesiones ya emitidas. Con estrategia JWT no hay fila de sesión que borrar, así
-- que la revocación necesita una marca en el usuario: el callback JWT descarta
-- todo token emitido antes de esta fecha.
--
-- Nula para todas las filas existentes = "nunca se revocó nada": el despliegue
-- no cierra la sesión de nadie.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sessions_valid_from" timestamp with time zone;
