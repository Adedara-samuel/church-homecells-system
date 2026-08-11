import mongoose from 'mongoose';
import { afterAll, beforeAll } from 'vitest';

// Values every suite depends on. Set before the application's `env` module is
// imported so its schema validation sees them.
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-16-chars';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-16-chars';
process.env.ENABLE_CRON_JOBS = 'false';
process.env.PAYMENT_PROVIDER = 'MOCK';
process.env.SMS_PROVIDER = 'MOCK';
// The logger silences itself in the test environment; this just keeps it quiet
// during the brief window before NODE_ENV is read.
process.env.LOG_LEVEL = 'fatal';

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI!, { dbName: 'chms_test' });
  }
});

afterAll(async () => {
  await mongoose.disconnect();
});
