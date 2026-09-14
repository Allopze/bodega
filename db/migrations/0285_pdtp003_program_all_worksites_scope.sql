-- PDTP-003 (auditoría 2026-09-14): un programa activo SIN ninguna faena
-- asociada se aplicaba a todas. `resolvePdtpActiveProgramForEvent` trataba
-- `members.length === 0` como "aplica a cualquier faena", de modo que un
-- programa creado y activado antes de asignarle faenas absorbía las
-- acreditaciones de toda la organización, y sus indicadores mezclaban faenas
-- que nunca se le asignaron. Podía ser deliberado —un programa corporativo—
-- pero era indistinguible de un programa mal configurado.
--
-- La columna vuelve explícita esa declaración. Backfill conservador: los
-- programas que HOY no declaran faenas se marcan corporativos, porque es el
-- comportamiento que ya tienen y esta migración no es el lugar para
-- reinterpretar programas vivos. Lo que cambia es de aquí en adelante: un
-- programa nuevo sin faenas y sin la declaración deja de acreditar en silencio
-- para todas y sus eventos quedan visibles en el libro de cumplimiento
-- (PDTP-002).
ALTER TABLE pdtp_programs
  ADD COLUMN IF NOT EXISTS applies_to_all_worksites boolean NOT NULL DEFAULT false;

UPDATE pdtp_programs
   SET applies_to_all_worksites = true
 WHERE NOT EXISTS (
   SELECT 1 FROM pdtp_program_worksites
    WHERE pdtp_program_worksites.program_id = pdtp_programs.id
      AND pdtp_program_worksites.is_active = true
 );
