import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_PASS, ADMIN_USER, createTestApp, type TestApp } from '../helpers.ts';
import { listRoutes } from '../../supabase/functions/api/app.ts';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp();
});

describe('participant registration', () => {
  it('registers with required fields; email optional', async () => {
    const r = await app.register({ email: '' });
    expect(r.status).toBe(200);
    expect(r.data.token).toBeTruthy();
    expect(r.data.link_status).toBe('linked');
    const me = await app.call('participant/me', {}, r.data.token);
    expect(me.data.phone).toBe('+91' + r.body.phone);
    expect(me.data).not.toHaveProperty('pin_hash');
  });

  it('validates required fields', async () => {
    expect((await app.register({ first_name: '' })).status).toBe(400);
    expect((await app.register({ last_name: '  ' })).status).toBe(400);
    expect((await app.register({ phone: '12345' })).status).toBe(400);
    expect((await app.register({ pin: '12a4' })).status).toBe(400);
    expect((await app.register({ pin: '0000' })).status).toBe(400);
    expect((await app.register({ email: 'not-an-email' })).status).toBe(400);
  });

  it('prevents duplicate accounts for the same normalized phone', async () => {
    expect((await app.register({ phone: '9811122233' })).status).toBe(200);
    const dup = await app.register({ phone: '+91 98111-22233' });
    expect(dup.status).toBe(409);
    expect(dup.data.error).toBe('phone_taken');
  });

  it('never stores the PIN in plain text', async () => {
    await app.register({ phone: '9811122299', pin: '7391' });
    const rows = await app.db.query<{ pin_hash: string }>('select pin_hash from participant_accounts');
    expect(rows.rows[0].pin_hash).toMatch(/^pbkdf2_sha256\$/);
    expect(rows.rows[0].pin_hash).not.toContain('7391');
  });

  it('respects the registration enabled setting', async () => {
    const admin = await app.adminToken();
    await app.call('admin/settings/update', { registration_enabled: false }, admin);
    expect((await app.register()).status).toBe(403);
    const cfg = await app.call('public/config');
    expect(cfg.data.registration_enabled).toBe(false);
  });

  it('requires admin confirmation when the phone matches a manually added participant', async () => {
    const admin = await app.adminToken();
    const p = await app.call('admin/participants/save', { first_name: 'Neha', last_name: 'Sharma', phone: '9822233344' }, admin);
    const r = await app.register({ first_name: 'Neha', last_name: 'Sharma', phone: '9822233344' });
    expect(r.data.link_status).toBe('pending');
    const list = await app.call('admin/participants/list', {}, admin);
    expect(list.data.pending_accounts).toHaveLength(1);
    expect(list.data.pending_accounts[0].candidates[0].id).toBe(p.data.participant.id);
    const link = await app.call('admin/accounts/link', { account_id: list.data.pending_accounts[0].id, participant_id: p.data.participant.id }, admin);
    expect(link.status).toBe(200);
    const after = await app.call('admin/participants/list', {}, admin);
    expect(after.data.pending_accounts).toHaveLength(0);
    expect(after.data.participants).toHaveLength(1);
    expect(after.data.participants[0].account.phone).toBe('+919822233344');
  });
});

describe('participant login', () => {
  it('logs in with phone + PIN in any common format', async () => {
    await app.register({ phone: '9833344455', pin: '2580' });
    const r = await app.call('participant/login', { phone: '+91 98333 44455', pin: '2580' });
    expect(r.status).toBe(200);
    expect(r.data.must_change_pin).toBe(false);
    expect((await app.call('participant/tracker', {}, r.data.token)).status).toBe(200);
  });

  it('gives the same error for unknown phone and wrong PIN', async () => {
    await app.register({ phone: '9833344456', pin: '2580' });
    const wrong = await app.call('participant/login', { phone: '9833344456', pin: '1111' });
    const unknown = await app.call('participant/login', { phone: '9000000001', pin: '1111' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.data.message).toBe(unknown.data.message);
  });

  it('locks out after repeated wrong PINs, even with the right PIN', async () => {
    await app.register({ phone: '9833344457', pin: '2580' });
    for (let i = 0; i < 5; i++) await app.call('participant/login', { phone: '9833344457', pin: '1111' });
    const locked = await app.call('participant/login', { phone: '9833344457', pin: '2580' });
    expect(locked.status).toBe(429);
    expect(locked.data.error).toBe('locked');
    // unknown phones are throttled the same way (no account enumeration)
    for (let i = 0; i < 5; i++) await app.call('participant/login', { phone: '9000000002', pin: '1111' });
    expect((await app.call('participant/login', { phone: '9000000002', pin: '1111' })).status).toBe(429);
  });

  it('lock escalates progressively', async () => {
    await app.register({ phone: '9833344458', pin: '2580' });
    for (let i = 0; i < 5; i++) await app.call('participant/login', { phone: '9833344458', pin: '1111' });
    await app.db.query(`update login_throttle set locked_until = now() - interval '1 second' where key = 'phone:+919833344458'`);
    for (let i = 0; i < 5; i++) await app.call('participant/login', { phone: '9833344458', pin: '1111' });
    const r = await app.db.query<{ secs: number }>(
      `select extract(epoch from locked_until - now())::int as secs from login_throttle where key = 'phone:+919833344458'`,
    );
    expect(r.rows[0].secs).toBeGreaterThan(200); // second level is 5 minutes
  });

  it('logout invalidates the session', async () => {
    const reg = await app.register();
    expect((await app.call('participant/logout', {}, reg.data.token)).status).toBe(200);
    expect((await app.call('participant/tracker', {}, reg.data.token)).status).toBe(401);
  });

  it('rejects participant tokens on admin routes and vice versa', async () => {
    const reg = await app.register();
    expect((await app.call('admin/participants/list', {}, reg.data.token)).status).toBe(401);
    const admin = await app.adminToken();
    expect((await app.call('participant/tracker', {}, admin)).status).toBe(401);
  });
});

describe('forced PIN change after admin reset', () => {
  it('resets to 0000, restricts the session, and requires a new PIN', async () => {
    const admin = await app.adminToken();
    const reg = await app.register({ phone: '9844455566', pin: '2580' });
    const list = await app.call('admin/participants/list', {}, admin);
    const accountId = list.data.participants[0].account.id;
    expect((await app.call('admin/accounts/reset-pin', { account_id: accountId }, admin)).status).toBe(200);

    // existing sessions are revoked and the old PIN no longer works
    expect((await app.call('participant/tracker', {}, reg.data.token)).status).toBe(401);
    expect((await app.call('participant/login', { phone: '9844455566', pin: '2580' })).status).toBe(401);

    const temp = await app.call('participant/login', { phone: '9844455566', pin: '0000' });
    expect(temp.status).toBe(200);
    expect(temp.data.must_change_pin).toBe(true);
    const blocked = await app.call('participant/tracker', {}, temp.data.token);
    expect(blocked.status).toBe(403);
    expect(blocked.data.error).toBe('pin_change_required');
    expect((await app.call('participant/my-performances', {}, temp.data.token)).status).toBe(403);

    expect((await app.call('participant/change-pin', { new_pin: '0000' }, temp.data.token)).status).toBe(400);
    expect((await app.call('participant/change-pin', { new_pin: '9753' }, temp.data.token)).status).toBe(200);
    expect((await app.call('participant/tracker', {}, temp.data.token)).status).toBe(200);
    expect((await app.call('participant/login', { phone: '9844455566', pin: '0000' })).status).toBe(401);
    expect((await app.call('participant/login', { phone: '9844455566', pin: '9753' })).status).toBe(200);

    const audit = await app.call('admin/audit-log', {}, admin);
    expect(audit.data.entries.some((e: { action: string; target_id: string }) => e.action === 'pin_reset' && e.target_id === accountId)).toBe(true);
  });

  it('temporary PIN expires', async () => {
    const admin = await app.adminToken();
    await app.register({ phone: '9844455567', pin: '2580' });
    const list = await app.call('admin/participants/list', {}, admin);
    await app.call('admin/accounts/reset-pin', { account_id: list.data.participants[0].account.id }, admin);
    await app.db.query(`update participant_accounts set temp_pin_expires_at = now() - interval '1 minute'`);
    const r = await app.call('participant/login', { phone: '9844455567', pin: '0000' });
    expect(r.status).toBe(401);
    expect(r.data.error).toBe('temp_pin_expired');
  });

  it('voluntary PIN change requires the current PIN', async () => {
    const reg = await app.register({ pin: '2580' });
    expect((await app.call('participant/change-pin', { current_pin: '1111', new_pin: '3698' }, reg.data.token)).status).toBe(401);
    expect((await app.call('participant/change-pin', { current_pin: '2580', new_pin: '3698' }, reg.data.token)).status).toBe(200);
  });
});

describe('blocked participants', () => {
  it('are denied server-side and their sessions revoked', async () => {
    const admin = await app.adminToken();
    const reg = await app.register({ phone: '9855566677', pin: '2580' });
    const list = await app.call('admin/participants/list', {}, admin);
    const accountId = list.data.participants[0].account.id;
    await app.call('admin/accounts/block', { account_id: accountId, blocked: true }, admin);
    expect((await app.call('participant/tracker', {}, reg.data.token)).status).toBe(401);
    const login = await app.call('participant/login', { phone: '9855566677', pin: '2580' });
    expect(login.status).toBe(403);
    expect(login.data.error).toBe('blocked');
    // admin still sees them and can unblock
    const again = await app.call('admin/participants/list', {}, admin);
    expect(again.data.participants[0].account.blocked).toBe(true);
    await app.call('admin/accounts/block', { account_id: accountId, blocked: false }, admin);
    expect((await app.call('participant/login', { phone: '9855566677', pin: '2580' })).status).toBe(200);
  });

  it('a session created before blocking is rejected', async () => {
    const admin = await app.adminToken();
    const reg = await app.register();
    const id = (await app.db.query<{ id: string }>('select id from participant_accounts')).rows[0].id;
    // block directly in the DB (sessions remain) to prove the per-request check
    await app.db.query('update participant_accounts set blocked_at = now() where id = $1', [id]);
    const r = await app.call('participant/tracker', {}, reg.data.token);
    expect(r.status).toBe(403);
    expect(r.data.error).toBe('blocked');
    expect(admin).toBeTruthy();
  });
});

describe('admin authentication & authorization', () => {
  it('bootstraps from server secrets and stores only a hash', async () => {
    const t = await app.adminToken();
    expect(t).toBeTruthy();
    const row = await app.db.query<{ password_hash: string }>('select password_hash from admin_credentials');
    expect(row.rows[0].password_hash).not.toContain(ADMIN_PASS);
  });

  it('rejects wrong password and rate-limits', async () => {
    expect((await app.call('admin/login', { username: ADMIN_USER, password: 'wrong-password' })).status).toBe(401);
    for (let i = 0; i < 5; i++) await app.call('admin/login', { username: ADMIN_USER, password: 'wrong-password' }, null, `10.1.0.${i}`);
    expect((await app.call('admin/login', { username: ADMIN_USER, password: ADMIN_PASS }, null, '10.2.0.1')).status).toBe(429);
  });

  it('every admin route rejects missing, participant and forged tokens', async () => {
    const reg = await app.register();
    const routes = Object.entries(listRoutes()).filter(([, a]) => a === 'admin').map(([r]) => r);
    expect(routes.length).toBeGreaterThan(25);
    for (const r of routes) {
      expect((await app.call(r, {})).status, r).toBe(401);
      expect((await app.call(r, {}, reg.data.token)).status, r).toBe(401);
      expect((await app.call(r, { isAdmin: true }, 'forged-token-forged-token-forged')).status, r).toBe(401);
    }
  });

  it('every participant route rejects anonymous calls', async () => {
    const routes = Object.entries(listRoutes()).filter(([, a]) => a.startsWith('participant')).map(([r]) => r);
    for (const r of routes) expect((await app.call(r, {})).status, r).toBe(401);
  });

  it('changes the password and signs out other admin devices', async () => {
    const a = await app.adminToken();
    const b = await app.adminToken();
    expect((await app.call('admin/change-password', { current_password: 'nope', new_password: 'another-long-password' }, a)).status).toBe(401);
    expect((await app.call('admin/change-password', { current_password: ADMIN_PASS, new_password: 'another-long-password' }, a)).status).toBe(200);
    expect((await app.call('admin/me', {}, a)).status).toBe(200);
    expect((await app.call('admin/me', {}, b)).status).toBe(401);
    expect((await app.call('admin/login', { username: ADMIN_USER, password: ADMIN_PASS })).status).toBe(401);
    expect((await app.call('admin/login', { username: ADMIN_USER, password: 'another-long-password' })).status).toBe(200);
  });

  it('expired admin sessions are rejected', async () => {
    const t = await app.adminToken();
    await app.db.query(`update auth_sessions set expires_at = now() - interval '1 second'`);
    expect((await app.call('admin/me', {}, t)).status).toBe(401);
  });
});

describe('database is locked down for browser roles', () => {
  it('anon cannot read tables or call functions directly', async () => {
    await app.register();
    await app.db.exec('set role anon');
    await expect(app.db.query('select * from participant_accounts')).rejects.toThrow(/permission denied/);
    await expect(app.db.query('select * from performances')).rejects.toThrow(/permission denied/);
    await expect(app.db.query('select * from performance_view')).rejects.toThrow(/permission denied/);
    await expect(app.db.query(`select public.admin_participants_list('{}'::jsonb)`)).rejects.toThrow(/permission denied/);
    await app.db.exec('reset role');
  });
});
