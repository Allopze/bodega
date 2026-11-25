import { sql } from "drizzle-orm"
import { fuelEquipmentTypes, mantEquipmentProfiles } from "@/db/schema"

/**
 * Medidor efectivo de un equipo de Mantención, como `odometer` / `hour_meter` / `none`: el de su
 * perfil (`mant_equipment_profiles.unit`) cuando está fijado y, si no, el de su tipo.
 *
 * Sustituye a `fuelEquipmentTypes.defaultMeterType` en toda consulta que decida la unidad de un
 * equipo (la unidad ya no sale sólo del tipo: un camión de producción mide en horas aunque su tipo
 * sea de odómetro). La consulta tiene que unir `fuel_equipment_types` y `mant_equipment_profiles`
 * (este último puede ir con `leftJoin`); el resultado se pasa por `unitFromMeter`, como antes.
 *
 * No toca `fuel_vehicles.meter_type`: ese medidor es de Combustible.
 */
export const effectiveMeterSql = sql<string>`coalesce(case ${mantEquipmentProfiles.unit} when 'km' then 'odometer' when 'h' then 'hour_meter' end, ${fuelEquipmentTypes.defaultMeterType})`
