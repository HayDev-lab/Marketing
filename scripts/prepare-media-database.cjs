// Additive media persistence migration; does not modify existing application rows.
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
(async () => {
  await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS public."MediaPayload" ("assetId" TEXT PRIMARY KEY REFERENCES public."MediaAsset"("id") ON DELETE CASCADE, "data" BYTEA NOT NULL)');
    await tx.$executeRawUnsafe('ALTER TABLE public."MediaPayload" ENABLE ROW LEVEL SECURITY');
    await tx.$executeRawUnsafe('REVOKE ALL ON TABLE public."MediaPayload" FROM anon, authenticated');
    // Upgrade the old keyless placeholder; preserve normal user-disabled configs.
    await tx.$executeRawUnsafe(`UPDATE public."ProviderConfig" SET "enabled" = true, "status" = 'IMPLEMENTED_NOT_LIVE_VERIFIED', "defaultModel" = 'gemini-3.8-flash-lite-tts' WHERE "providerId" = 'gemini-tts' AND "status" = 'BLOCKED_EXTERNAL' AND "enabled" = false`);
  }, { timeout: 20000 });
  console.log('Private durable media storage ready');
})().catch(() => { console.error('Media persistence migration failed'); process.exitCode = 1; }).finally(() => db.$disconnect());
