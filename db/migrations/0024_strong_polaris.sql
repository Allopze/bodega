-- Step 1: Add synthetic id column to pdtp_sheets (initially nullable)
ALTER TABLE "pdtp_sheets" ADD COLUMN "id" text;
-- Step 2: Populate id with the current code value
UPDATE "pdtp_sheets" SET "id" = "code";
-- Step 3: Make id NOT NULL now that all rows have a value
ALTER TABLE "pdtp_sheets" ALTER COLUMN "id" SET NOT NULL;
-- Step 4: Drop the old PK on code (need to first drop the FK in sheet_activities)
ALTER TABLE "pdtp_sheet_activities" DROP CONSTRAINT "pdtp_sheet_activities_sheet_code_pdtp_sheets_code_fk";
ALTER TABLE "pdtp_sheets" DROP CONSTRAINT "pdtp_sheets_pkey";
-- Step 5: Create new PK on id
ALTER TABLE "pdtp_sheets" ADD PRIMARY KEY ("id");
-- Step 6: Add program_id column (nullable - template sheets have NULL)
ALTER TABLE "pdtp_sheets" ADD COLUMN "program_id" text;
ALTER TABLE "pdtp_sheets" ADD CONSTRAINT "pdtp_sheets_program_id_pdtp_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."pdtp_programs"("id") ON DELETE no action ON UPDATE no action;
-- Step 7: Unique constraint on (program_id, code) with NULLS NOT DISTINCT
-- so template sheets (program_id=NULL) cannot have duplicate codes either
CREATE UNIQUE INDEX "pdtp_sheets_program_code_unique" ON "pdtp_sheets" USING btree ("program_id","code") NULLS NOT DISTINCT;
-- Step 8: Add sheet_id to pdtp_sheet_activities pointing to new PK
ALTER TABLE "pdtp_sheet_activities" ADD COLUMN "sheet_id" text;
-- Step 9: Populate sheet_id from the existing sheet_code (maps code → id)
UPDATE "pdtp_sheet_activities" sa SET "sheet_id" = s."id" FROM "pdtp_sheets" s WHERE sa."sheet_code" = s."code";
-- Step 10: Make sheet_id NOT NULL
ALTER TABLE "pdtp_sheet_activities" ALTER COLUMN "sheet_id" SET NOT NULL;
-- Step 11: Add FK constraint from sheet_id → pdtp_sheets.id
ALTER TABLE "pdtp_sheet_activities" ADD CONSTRAINT "pdtp_sheet_activities_sheet_id_pdtp_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."pdtp_sheets"("id") ON DELETE cascade ON UPDATE no action;
-- Step 12: Update indexes on pdtp_sheet_activities to use sheet_id instead of sheet_code
DROP INDEX IF EXISTS "pdtp_sheet_activities_sheet_activity_unique";
DROP INDEX IF EXISTS "pdtp_sheet_activities_sheet_order_idx";
CREATE UNIQUE INDEX "pdtp_sheet_activities_sheet_activity_unique" ON "pdtp_sheet_activities" USING btree ("sheet_id","activity_id");
CREATE INDEX "pdtp_sheet_activities_sheet_order_idx" ON "pdtp_sheet_activities" USING btree ("sheet_id","display_order");
