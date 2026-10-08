const { PrismaClient, Prisma } = require('@prisma/client');
const db = new PrismaClient();
(async () => {
  const schema = new URL(process.env.DATABASE_URL).searchParams.get('schema') || 'public';
  const quote = value => '"' + value.replaceAll('"', '""') + '"';
  for (const model of Prisma.dmmf.datamodel.models) {
    const table = `${quote(schema)}.${quote(model.dbName || model.name)}`;
    await db.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await db.$executeRawUnsafe(`REVOKE ALL ON TABLE ${table} FROM anon, authenticated`);
  }
  console.log('Application tables protected from public Data API access');
})().catch(() => { console.error('Database protection failed'); process.exitCode = 1; }).finally(() => db.$disconnect());
