/**
 * Backfill Contact.lastInboundAt + lastOutboundAt từ Friend records.
 * 2026-05-29 — Phase Lead Pool v2.A: forgotten pool đổi sang lastInboundAt.
 *
 * Run trong container: node scripts/backfill-contact-inbound.mjs
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const total = await prisma.contact.count({ where: { mergedInto: null } });
  console.log(`Backfill lastInboundAt/lastOutboundAt cho ${total} contacts...`);

  const BATCH = 500;
  let processed = 0;
  let updated = 0;

  while (processed < total) {
    const contacts = await prisma.contact.findMany({
      where: { mergedInto: null },
      select: { id: true },
      skip: processed,
      take: BATCH,
      orderBy: { createdAt: 'asc' },
    });
    if (contacts.length === 0) break;

    for (const c of contacts) {
      const friends = await prisma.friend.findMany({
        where: { contactId: c.id },
        select: { lastInboundAt: true, lastOutboundAt: true },
      });

      let lastInboundAt = null;
      let lastOutboundAt = null;
      for (const f of friends) {
        if (f.lastInboundAt && (!lastInboundAt || f.lastInboundAt > lastInboundAt)) lastInboundAt = f.lastInboundAt;
        if (f.lastOutboundAt && (!lastOutboundAt || f.lastOutboundAt > lastOutboundAt)) lastOutboundAt = f.lastOutboundAt;
      }

      if (lastInboundAt || lastOutboundAt) {
        await prisma.contact.update({
          where: { id: c.id },
          data: { lastInboundAt, lastOutboundAt },
        });
        updated++;
      }
    }
    processed += contacts.length;
    if (processed % 1000 === 0 || processed === total) {
      console.log(`Tiến độ: ${processed}/${total} (đã update ${updated})`);
    }
  }

  console.log(`Done. Updated ${updated}/${total} contacts.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
