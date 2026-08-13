/**
 * Fills in `remittedAt` for remittances recorded before the field existed.
 *
 * Reads already fall back to the calendar date, and the model backfills on save, so
 * this is not required for correctness — it exists so historical records carry the
 * value in the database rather than deriving it on every read, and so reporting that
 * groups by `remittedAt` sees the full history.
 *
 *   npm run backfill:remitted-at
 *
 * Safe to run repeatedly: only documents with no value are touched.
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../db/connection';
import { Remittance } from '../modules/remittances/remittance.model';

async function main(): Promise<void> {
  await connectDatabase();

  const missing = await Remittance.countDocuments({
    $or: [{ remittedAt: { $exists: false } }, { remittedAt: null }],
  });

  if (missing === 0) {
    console.log('\n  Every remittance already has a timestamp. Nothing to do.\n');
    return;
  }

  console.log(`\n  Backfilling ${missing} remittance${missing === 1 ? '' : 's'}…`);

  // Midday rather than midnight: only the calendar date was ever known, and midday
  // survives a timezone shift in either direction without landing on the wrong day.
  const result = await Remittance.collection.updateMany(
    { $or: [{ remittedAt: { $exists: false } }, { remittedAt: null }] },
    [
      {
        $set: {
          remittedAt: {
            $dateAdd: { startDate: '$date', unit: 'hour', amount: 12 },
          },
        },
      },
    ],
  );

  console.log(`  Updated ${result.modifiedCount} record${result.modifiedCount === 1 ? '' : 's'}.\n`);
}

main()
  .then(async () => {
    await disconnectDatabase();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(`\n  Failed: ${(err as Error).message}\n`);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
