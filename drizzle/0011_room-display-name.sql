ALTER TABLE "room" ADD COLUMN "name" text DEFAULT '' NOT NULL;
UPDATE "room" SET "name" = "room_code" WHERE "name" = '';
