import { defineConfig } from "prisma/config";

const datasource: { url: string; shadowDatabaseUrl?: string } = {
  url: process.env.DATABASE_URL!,
};

// Shadow DB is only required for `prisma migrate dev` (development workflow).
// In CI/production we use `prisma migrate deploy`, which does not need shadow DB.
if (process.env.SHADOW_DATABASE_URL) {
  datasource.shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource,
});
