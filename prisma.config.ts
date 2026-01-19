import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL!,
    // Shadow DB is only required for `prisma migrate dev` (development workflow).
    // In CI/production we use `prisma migrate deploy`, which does not need shadow DB.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
