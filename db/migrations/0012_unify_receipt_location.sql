-- Unify receipt location vocabulary: the two-stage receiving flow uses
-- 'office' (arrival at Chome office) and 'faena' (receipt at worksite).
-- Any rows written by the in-flight code under 'bodega' become 'faena'.
UPDATE `receipts` SET `location_type` = 'faena' WHERE `location_type` = 'bodega';
