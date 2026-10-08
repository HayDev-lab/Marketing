// Additive media persistence migration; does not modify existing application rows.
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
(async () => {
  await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS public."MediaPayload" ("assetId" TEXT PRIMARY KEY REFERENCES public."MediaAsset"("id") ON DELETE CASCADE, "data" BYTEA NOT NULL)');
    await tx.$executeRawUnsafe('ALTER TABLE public."MediaPayload" ENABLE ROW LEVEL SECURITY');
    await tx.$executeRawUnsafe('REVOKE ALL ON TABLE public."MediaPayload" FROM anon, authenticated');
  }, { timeout: 20000 });
  console.log('Private durable media storage ready');
})().catch(() => { console.error('Media persistence migration failed'); process.exitCode = 1; }).finally(() => db.$disconnect());
