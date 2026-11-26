import { beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, MP3_BYTES, type TestApp } from '../helpers.ts';

let app: TestApp;
let admin: string;

beforeEach(async () => {
  app = await createTestApp();
  admin = await app.adminToken();
});

async function person(first: string, side: 'bride' | 'groom' = 'groom', phone?: string) {
  const r = await app.call('admin/participants/save', { first_name: first, last_name: 'Sharma', side, phone }, admin);
  expect(r.status).toBe(200);
  return r.data.participant.id as string;
}

async function perf(over: Record<string, unknown> = {}) {
  const r = await app.call(
    'admin/performances/save',
    {
      display_name: 'Dance',
      side: 'groom',
      performance_type: 'group',
      song_title: 'Kala Chashma',
      preparation_status: 'draft',
      participant_ids: [],
      ...over,
    },
    admin,
  );
  expect(r.status, JSON.stringify(r.data)).toBe(200);
  return r.data.performance;
}

describe('performances', () => {
  it('creates performances with many participants and appends to the running order', async () => {
    const a = await person('Priya', 'bride');
    const b = await person('Amit', 'bride');
    const p1 = await perf({ display_name: 'Couple', side: 'bride', participant_ids: [a, b] });
    const p2 = await perf({ display_name: 'Second' });
    expect(p1.position).toBe(1);
    expect(p2.position).toBe(2);
    expect(p1.participants.map((x: { first_name: string }) => x.first_name)).toEqual(['Amit', 'Priya']);
    expect(p1).not.toHaveProperty('audio_storage_path');
  });

  it('enforces solo = one participant and Ready requirements', async () => {
    const a = await person('Rahul');
    const b = await person('Rohan');
    const solo = await app.call(
      'admin/performances/save',
      { display_name: 'S', side: 'groom', performance_type: 'solo', song_title: 'X', preparation_status: 'draft', participant_ids: [a, b] },
      admin,
    );
    expect(solo.status).toBe(422);
    const ready = await app.call(
      'admin/performances/save',
      { display_name: 'S', side: 'groom', performance_type: 'solo', song_title: 'X', preparation_status: 'ready', participant_ids: [a] },
      admin,
    );
    expect(ready.status).toBe(422);
    expect(ready.data.error).toBe('not_ready');
    const p = await perf({ performance_type: 'solo', participant_ids: [a] });
    expect((await app.uploadAudio(admin, p.id)).status).toBe(200);
    const ok = await app.call(
      'admin/performances/save',
      { id: p.id, display_name: 'S', side: 'groom', performance_type: 'solo', song_title: 'X', preparation_status: 'ready', participant_ids: [a] },
      admin,
    );
    expect(ok.status).toBe(200);
    expect(ok.data.performance.preparation_status).toBe('ready');
  });

  it('rejects non-YouTube links and script URLs', async () => {
    const r = await app.call(
      'admin/performances/save',
      { display_name: 'D', side: 'groom', performance_type: 'group', song_title: 'X', preparation_status: 'draft', participant_ids: [], youtube_url: 'javascript:alert(1)' },
      admin,
    );
    expect(r.status).toBe(400);
  });

  it('prevents deleting a participant who is in a performance; archive works', async () => {
    const a = await person('Kiran');
    await perf({ participant_ids: [a] });
    const del = await app.call('admin/participants/delete', { id: a }, admin);
    expect(del.status).toBe(409);
    expect((await app.call('admin/participants/set-active', { id: a, active: false }, admin)).status).toBe(200);
    const free = await person('Free');
    expect((await app.call('admin/participants/delete', { id: free }, admin)).status).toBe(200);
  });
});

describe('audio upload, playback and download permissions', () => {
  it('validates type, size and real content', async () => {
    const p = await perf();
    const exe = await app.call('admin/audio/upload-url', { performance_id: p.id, filename: 'x.exe', size: 10, mime: 'application/x-msdownload' }, admin);
    expect(exe.status).toBe(415);
    const big = await app.call('admin/audio/upload-url', { performance_id: p.id, filename: 'x.mp3', size: 60 * 1024 * 1024, mime: 'audio/mpeg' }, admin);
    expect(big.status).toBe(413);
    const fake = await app.uploadAudio(admin, p.id, new TextEncoder().encode('<html>not audio at all</html>'), 'fake.mp3');
    expect(fake.status).toBe(415);
    const after = await app.call('admin/performances/get', { id: p.id }, admin);
    expect(after.data.performance.has_audio).toBe(false);
  });

  it('stores audio privately and gives admin play + download URLs with the generated filename', async () => {
    const a = await person('Rahul');
    const p = await perf({ performance_type: 'solo', participant_ids: [a] });
    const up = await app.uploadAudio(admin, p.id, MP3_BYTES, 'WhatsApp Audio 2025-01-01.mp3', 135);
    expect(up.status).toBe(200);
    expect(up.data.performance.duration_seconds).toBe(135);
    expect(up.data.performance.original_filename).toBe('WhatsApp Audio 2025-01-01.mp3');

    const play = await app.call('admin/audio/url', { performance_id: p.id, purpose: 'play' }, admin);
    expect(play.status).toBe(200);
    const res = await app.storage.handle(new Request(play.data.url));
    expect(res!.status).toBe(200);
    expect(new Uint8Array(await res!.arrayBuffer())).toEqual(MP3_BYTES);

    const dl = await app.call('admin/audio/url', { performance_id: p.id, purpose: 'download' }, admin);
    expect(dl.data.filename).toBe('001_GROOM_RAHUL_SOLO_02-15.mp3');
    const dres = await app.storage.handle(new Request(dl.data.url));
    expect(dres!.headers.get('content-disposition')).toContain('001_GROOM_RAHUL_SOLO_02-15.mp3');

    // tampered / unsigned URLs are refused
    const tampered = play.data.url.replace(/sig=[0-9a-f]+/, 'sig=' + '0'.repeat(64));
    expect((await app.storage.handle(new Request(tampered)))!.status).toBe(403);
  });

  it('plays the correct clip for each performance', async () => {
    const p1 = await perf({ display_name: 'One' });
    const p2 = await perf({ display_name: 'Two' });
    const clip2 = new Uint8Array([...MP3_BYTES.slice(0, 20), 7, 7, 7]);
    await app.uploadAudio(admin, p1.id, MP3_BYTES);
    await app.uploadAudio(admin, p2.id, clip2);
    const u2 = await app.call('admin/audio/url', { performance_id: p2.id, purpose: 'play' }, admin);
    const body = new Uint8Array(await (await app.storage.handle(new Request(u2.data.url)))!.arrayBuffer());
    expect(body).toEqual(clip2);
  });

  it('participants can download only their own performance audio', async () => {
    const reg = await app.register({ first_name: 'Asha', last_name: 'Rao', phone: '9866677788' });
    const other = await app.register({ first_name: 'Bina', last_name: 'Rao', phone: '9866677799' });
    const list = await app.call('admin/participants/list', {}, admin);
    const asha = list.data.participants.find((x: { first_name: string }) => x.first_name === 'Asha').id;
    const mine = await perf({ display_name: 'Asha solo', performance_type: 'solo', participant_ids: [asha] });
    const notMine = await perf({ display_name: 'Other' });
    await app.uploadAudio(admin, mine.id);
    await app.uploadAudio(admin, notMine.id);

    const ok = await app.call('participant/audio-download', { performance_id: mine.id }, reg.data.token);
    expect(ok.status).toBe(200);
    expect(ok.data.filename).toMatch(/^001_GROOM_ASHA_SOLO_02-15\.mp3$/);
    expect((await app.call('participant/audio-download', { performance_id: notMine.id }, reg.data.token)).status).toBe(403);
    expect((await app.call('participant/audio-download', { performance_id: mine.id }, other.data.token)).status).toBe(403);
    expect((await app.call('participant/audio-download', { performance_id: mine.id })).status).toBe(401);

    const my = await app.call('participant/my-performances', {}, reg.data.token);
    expect(my.data.items.map((x: { id: string }) => x.id)).toEqual([mine.id]);
    expect((await app.call('participant/my-performances', {}, other.data.token)).data.items).toEqual([]);
  });

  it('a pending (unconfirmed) account cannot access audio for a matching manual participant', async () => {
    const manual = await person('Meera', 'bride', '9877788899');
    const p = await perf({ performance_type: 'solo', participant_ids: [manual] });
    await app.uploadAudio(admin, p.id);
    const impostor = await app.register({ first_name: 'Meera', last_name: 'Sharma', phone: '9877788899' });
    expect(impostor.data.link_status).toBe('pending');
    expect((await app.call('participant/audio-download', { performance_id: p.id }, impostor.data.token)).status).toBe(403);
  });
});

describe('song library and duplicate warnings', () => {
  it('groups title variants, ignores YouTube URLs, and lists all matching performances', async () => {
    const a = await person('Neha', 'bride');
    const b = await person('Amit');
    await perf({ display_name: 'Girls', side: 'bride', song_title: 'I Want It That Way', youtube_url: 'https://youtu.be/aaa', participant_ids: [a] });
    await perf({ display_name: 'Boys', song_title: 'i want it that way!', youtube_url: 'https://www.youtube.com/watch?v=bbb', participant_ids: [b] });
    await perf({ display_name: 'Other', song_title: 'Badtameez Dil' });

    const songs = await app.call('admin/songs/list', {}, admin);
    expect(songs.data.songs.map((s: { title: string }) => s.title)).toEqual(['Badtameez Dil', 'I Want It That Way']);
    const dup = songs.data.songs.find((s: { count: number }) => s.count === 2);
    expect(dup.key).toBe('i want it that way');

    const detail = await app.call('admin/songs/get', { key: dup.key }, admin);
    expect(detail.data.items.map((x: { display_name: string }) => x.display_name)).toEqual(['Girls', 'Boys']);
    expect(detail.data.items[0].participants[0].first_name).toBe('Neha');

    const dash = await app.call('admin/dashboard', {}, admin);
    expect(dash.data.duplicate_titles).toBe(1);
    // both performances remain — warning only
    expect(dash.data.performances_total).toBe(3);
  });
});

describe('running order & live mode', () => {
  async function three() {
    const p1 = await perf({ display_name: 'A' });
    const p2 = await perf({ display_name: 'B' });
    const p3 = await perf({ display_name: 'C' });
    return [p1, p2, p3];
  }

  it('reorders, renumbers and persists (survives refresh)', async () => {
    const [p1, p2, p3] = await three();
    const ro = await app.call('admin/running-order', {}, admin);
    const r = await app.call('admin/running-order/reorder', { ids: [p3.id, p1.id, p2.id], expected_revision: ro.data.order_revision }, admin);
    expect(r.status).toBe(200);
    expect(r.data.items.map((x: { display_name: string; position: number }) => `${x.position}${x.display_name}`)).toEqual(['1C', '2A', '3B']);
    const fresh = await app.call('admin/running-order', {}, admin);
    expect(fresh.data.items.map((x: { display_name: string }) => x.display_name)).toEqual(['C', 'A', 'B']);
  });

  it('download filename follows the current order', async () => {
    const [p1, , p3] = await three();
    await app.uploadAudio(admin, p3.id);
    expect((await app.call('admin/audio/url', { performance_id: p3.id, purpose: 'download' }, admin)).data.filename).toMatch(/^003_/);
    const ro = await app.call('admin/running-order', {}, admin);
    const ids = ro.data.items.map((x: { id: string }) => x.id);
    await app.call('admin/running-order/reorder', { ids: [p3.id, ...ids.filter((i: string) => i !== p3.id)], expected_revision: ro.data.order_revision }, admin);
    expect((await app.call('admin/audio/url', { performance_id: p3.id, purpose: 'download' }, admin)).data.filename).toMatch(/^001_/);
    expect(p1).toBeTruthy();
  });

  it('rejects a stale reorder from a second device instead of overwriting', async () => {
    const [p1, p2, p3] = await three();
    const rev = (await app.call('admin/running-order', {}, admin)).data.order_revision;
    expect((await app.call('admin/running-order/reorder', { ids: [p2.id, p1.id, p3.id], expected_revision: rev }, admin)).status).toBe(200);
    const stale = await app.call('admin/running-order/reorder', { ids: [p3.id, p2.id, p1.id], expected_revision: rev }, admin);
    expect(stale.status).toBe(409);
    expect(stale.data.latest.items.map((x: { display_name: string }) => x.display_name)).toEqual(['B', 'A', 'C']);
  });

  it('rejects reorder with a missing or extra id', async () => {
    const [p1, p2] = await three();
    const rev = (await app.call('admin/running-order', {}, admin)).data.order_revision;
    expect((await app.call('admin/running-order/reorder', { ids: [p1.id, p2.id], expected_revision: rev }, admin)).status).toBe(409);
  });

  it('marks Completed / Skipped / Pending with version checks', async () => {
    const [p1] = await three();
    const done = await app.call('admin/running-order/set-status', { id: p1.id, status: 'completed', expected_version: p1.version }, admin);
    expect(done.status).toBe(200);
    expect(done.data.performance.live_status).toBe('completed');
    // same change from a stale device is idempotent
    expect((await app.call('admin/running-order/set-status', { id: p1.id, status: 'completed', expected_version: p1.version }, admin)).status).toBe(200);
    // a different change from a stale device is a conflict
    const conflict = await app.call('admin/running-order/set-status', { id: p1.id, status: 'skipped', expected_version: p1.version }, admin);
    expect(conflict.status).toBe(409);
    expect(conflict.data.performance.live_status).toBe('completed');
    const v = done.data.performance.version;
    const skip = await app.call('admin/running-order/set-status', { id: p1.id, status: 'skipped', expected_version: v }, admin);
    expect(skip.data.performance.live_status).toBe('skipped');
    const back = await app.call('admin/running-order/set-status', { id: p1.id, status: 'pending', expected_version: skip.data.performance.version }, admin);
    expect(back.data.performance.live_status).toBe('pending');
    const fresh = await app.call('admin/running-order', {}, admin);
    expect(fresh.data.items[0].live_status).toBe('pending');
  });

  it('cheap polling returns "unchanged" until something changes', async () => {
    const [p1] = await three();
    const first = await app.call('admin/running-order', {}, admin);
    const again = await app.call('admin/running-order', { known_version: first.data.data_version }, admin);
    expect(again.data.unchanged).toBe(true);
    await app.call('admin/running-order/set-status', { id: p1.id, status: 'completed', expected_version: p1.version }, admin);
    const changed = await app.call('admin/running-order', { known_version: first.data.data_version }, admin);
    expect(changed.data.unchanged).toBe(false);
    expect(changed.data.items[0].live_status).toBe('completed');
  });
});

describe('duration threshold', () => {
  it('flags but does not block long clips', async () => {
    await app.call('admin/settings/update', { max_duration_seconds: 120 }, admin);
    const p = await perf();
    const up = await app.uploadAudio(admin, p.id, MP3_BYTES, 'long.mp3', 200);
    expect(up.status).toBe(200);
    const dash = await app.call('admin/dashboard', {}, admin);
    expect(dash.data.over_duration).toBe(1);
    expect((await app.call('admin/performances/set-duration', { id: p.id, duration_seconds: 100 }, admin)).status).toBe(200);
    expect((await app.call('admin/dashboard', {}, admin)).data.over_duration).toBe(0);
  });
});

describe('progress tracker & WhatsApp names (privacy)', () => {
  it('shows only counts and names of included people', async () => {
    const reg = await app.register({ first_name: 'Zoya', last_name: 'Khan', phone: '9888899900' });
    const a = await person('Priya', 'bride');
    await person('Unused', 'groom');
    await perf({ display_name: 'Secret Dance', song_title: 'Secret Song Title', youtube_url: 'https://youtu.be/zzz', admin_notes: 'private note', participant_ids: [a] });
    await perf({ display_name: 'Again', song_title: 'Another', participant_ids: [a] });

    const t = await app.call('participant/tracker', {}, reg.data.token);
    expect(t.status).toBe(200);
    expect(Object.keys(t.data).sort()).toEqual(['by_side', 'included', 'names', 'not_included', 'total']);
    expect(t.data.total).toBe(3);
    expect(t.data.included).toBe(1);
    expect(t.data.not_included).toBe(2);
    expect(t.data.names).toEqual(['Priya Sharma']); // listed once even though in 2 performances
    const text = JSON.stringify(t.data);
    expect(text).not.toMatch(/Secret|youtu|private note|solo|group|position|sort_order|\bAnother\b/i);

    const names = await app.call('admin/progress-names', {}, admin);
    expect(names.data.names).toEqual(['Priya Sharma']);
  });
});
