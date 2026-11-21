-- Aligns the database with schema.prisma (production readiness audit, `prisma migrate diff`):
-- `global_products.type` is declared `@default(stock)` but the column never had a database
-- default. Prisma always sends a value, so behavior is unchanged; this only makes a raw INSERT
-- (e.g. a catalog import) behave like the app. No row is touched.
ALTER TABLE "global_products" ALTER COLUMN "type" SET DEFAULT 'stock';
