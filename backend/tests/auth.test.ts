import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { API, getApp, login, resetDatabase, seedFixture, TEST_PASSWORD, type Fixture } from './helpers';

describe('Authentication', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    await resetDatabase();
    fixture = await seedFixture();
  });

  it('signs in with a valid email and password', async () => {
    const response = await request(getApp())
      .post(`${API}/auth/login`)
      .send({ identifier: 'sysadmin@test.org', password: TEST_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.data.accessToken).toBeTruthy();
    expect(response.body.data.user.role).toBe('SYSTEM_ADMIN');
    expect(response.body.data.user.permissions.length).toBeGreaterThan(0);
  });

  it('never returns the password hash', async () => {
    const response = await request(getApp())
      .post(`${API}/auth/login`)
      .send({ identifier: 'sysadmin@test.org', password: TEST_PASSWORD });

    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(response.body.data.user.passwordHash).toBeUndefined();
  });

  it('rejects an incorrect password without revealing whether the account exists', async () => {
    const wrongPassword = await request(getApp())
      .post(`${API}/auth/login`)
      .send({ identifier: 'sysadmin@test.org', password: 'WrongPassword#1' });

    const unknownAccount = await request(getApp())
      .post(`${API}/auth/login`)
      .send({ identifier: 'nobody@test.org', password: 'WrongPassword#1' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownAccount.status).toBe(401);
    // Identical responses: an attacker cannot enumerate accounts.
    expect(wrongPassword.body.error.message).toBe(unknownAccount.body.error.message);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('refuses to sign in an inactive account even with the correct password', async () => {
    const response = await request(getApp())
      .post(`${API}/auth/login`)
      .send({ identifier: 'inactive@test.org', password: TEST_PASSWORD });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('rejects a request with no token', async () => {
    const response = await request(getApp()).get(`${API}/members`);
    expect(response.status).toBe(401);
  });

  it('rejects a malformed token', async () => {
    const response = await request(getApp())
      .get(`${API}/members`)
      .set('Authorization', 'Bearer not-a-real-token');
    expect(response.status).toBe(401);
  });

  it('returns the current session for a valid token', async () => {
    const token = await login('hc.a1a@test.org');
    const response = await request(getApp())
      .get(`${API}/auth/session`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.user.role).toBe('HOMECELL_COORDINATOR');
    expect(response.body.data.user.homecell).toBe(fixture.homecellA1a);
  });

  it('exchanges a refresh token for a new access token and rotates it', async () => {
    const loginResponse = await request(getApp())
      .post(`${API}/auth/login`)
      .send({ identifier: 'churchadmin@test.org', password: TEST_PASSWORD });

    const refreshToken = loginResponse.body.data.refreshToken as string;

    const first = await request(getApp()).post(`${API}/auth/refresh`).send({ refreshToken });
    expect(first.status).toBe(200);
    expect(first.body.data.accessToken).toBeTruthy();
    expect(first.body.data.refreshToken).not.toBe(refreshToken);

    // Reusing a rotated token is treated as theft and revokes the session family.
    const replay = await request(getApp()).post(`${API}/auth/refresh`).send({ refreshToken });
    expect(replay.status).toBe(401);
  });
});
