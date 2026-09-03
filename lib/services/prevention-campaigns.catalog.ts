/**
 * Catálogo de las actividades PDTP que las campañas preventivas acreditan.
 *
 * Vive en su propio módulo (sin importar `@/db` ni otros servicios de servidor)
 * para que los componentes cliente puedan consumirlo sin arrastrar `postgres`
 * al bundle del navegador. `prevention-campaigns.ts` lo re-exporta para no
 * romper a los importadores de servidor.
 */
export const PDTP_CAMPAIGN_ACTIVITIES = [
  { n: 85, label: "Vida saludable, alimentación y actividad física" },
  { n: 86, label: "Manejo del estrés" },
  { n: 87, label: "Alcohol y drogas no van al volante" },
  { n: 88, label: "Seguridad vial" },
  { n: 89, label: "Puntos ciegos en la conducción y operación" },
] as const
