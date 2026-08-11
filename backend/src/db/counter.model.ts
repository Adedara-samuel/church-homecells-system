import { Schema, model, type ClientSession, type Model } from 'mongoose';

export interface CounterDoc {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<CounterDoc>(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { versionKey: false },
);

export const Counter: Model<CounterDoc> = model<CounterDoc>('Counter', counterSchema);

/**
 * Atomically allocates the next value in a named sequence.
 * Used for human-facing identifiers such as `MBR-000123`.
 */
export async function nextSequence(name: string, session?: ClientSession): Promise<number> {
  const doc = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session: session ?? undefined },
  ).lean();
  return doc!.seq;
}
