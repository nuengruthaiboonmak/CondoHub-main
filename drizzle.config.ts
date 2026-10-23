import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: [
    "./src/modules/identity-access/infrastructure/betterAuthSchema.ts",
    "./src/modules/property-membership/infrastructure/schema.ts",
    "./src/modules/announcements/infrastructure/schema.ts",
    "./src/modules/facility-booking/infrastructure/schema.ts",
    "./src/modules/media-attachments/infrastructure/schema.ts",
    "./src/modules/billing-payments/infrastructure/schema.ts",
    "./src/modules/maintenance/infrastructure/schema.ts",
    "./src/modules/room-chat/infrastructure/schema.ts",
    "./src/shared/db/schema/audit.ts",
    "./src/shared/db/schema/jobs.ts",
    "./src/shared/db/schema/idempotency.ts",
  ],
  out: "./drizzle",
  strict: true,
  verbose: true,
});
