import { describe, expect, it } from 'vitest';
import { formatPhone, normalizePhone } from '../../supabase/functions/_shared/phone.ts';
import { findDuplicateTitles, normalizeSongTitle } from '../../supabase/functions/_shared/songs.ts';
import { buildAudioFilename, performerLabel } from '../../supabase/functions/_shared/filename.ts';
import { formatDuration, isOverLimit, parseDuration } from '../../supabase/functions/_shared/duration.ts';
import { contentMatchesFormat, resolveAudioFormat, sniffAudio } from '../../supabase/functions/_shared/audio.ts';
import { buildProgressMessage, whatsappShareUrl } from '../../supabase/functions/_shared/whatsapp.ts';
import { hashSecret, randomToken, sha256Hex, verifySecret } from '../../supabase/functions/_shared/crypto.ts';
import { normalizeYouTubeUrl, validateName, validateNewPin } from '../../supabase/functions/_shared/validation.ts';

describe('phone normalization', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['+91 98765-43210', '+919876543210'],
    ['+91 (98765) 43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['0091 9876543210', '+919876543210'],
    ['+1 415 555 2671', '+14155552671'],
    ['+44 7911 123456', '+447911123456'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['', '12345', '5876543210', '+91 1234567890', 'abc9876543210', '98765+43210', '+0123456789', '41555526711'])(
    'rejects %s',
    (input) => expect(normalizePhone(input)).toBeNull(),
  );

  it('formats Indian numbers for display', () => {
    expect(formatPhone('+919876543210')).toBe('+91 98765 43210');
    expect(formatPhone('+14155552671')).toBe('+14155552671');
  });
});

describe('song title normalization & duplicates', () => {
  it('matches case, punctuation and whitespace variants', () => {
    expect(normalizeSongTitle('I Want It That Way')).toBe(normalizeSongTitle('  i want it that way!  '));
    expect(normalizeSongTitle("Don't  Stop   Me Now")).toBe('dont stop me now');
    expect(normalizeSongTitle('Kala Chashma - Remix')).toBe('kala chashma remix');
    expect(normalizeSongTitle('Café del Mar')).toBe('cafe del mar');
  });

  it('keeps non-Latin scripts intact', () => {
    const t = normalizeSongTitle('लंदन ठुमकदा!');
    expect(t).toBe('लंदन ठुमकदा');
    expect(normalizeSongTitle('लंदन   ठुमकदा')).toBe(t);
  });

  it('finds duplicates regardless of YouTube URL', () => {
    const groups = findDuplicateTitles([
      { id: '1', song_title: 'Gallan Goodiyaan', youtube_url: 'https://youtu.be/a' },
      { id: '2', song_title: 'gallan goodiyaan!!', youtube_url: 'https://youtu.be/b' },
      { id: '3', song_title: 'London Thumakda', youtube_url: 'https://youtu.be/a' },
    ]);
    expect([...groups.keys()]).toEqual(['gallan goodiyaan']);
    expect(groups.get('gallan goodiyaan')!.map((x) => x.id)).toEqual(['1', '2']);
  });
});

describe('download filename', () => {
  const base = { side: 'groom', performance_type: 'solo', duration_seconds: 135, display_name: 'Rahul Solo', path: 'performances/x/y.mp3' };
  it('follows ORDER_SIDE_NAMES_TYPE_DURATION.ext', () => {
    expect(buildAudioFilename({ ...base, position: 1, first_names: ['Rahul'] })).toBe('001_GROOM_RAHUL_SOLO_02-15.mp3');
    expect(
      buildAudioFilename({ ...base, position: 2, side: 'bride', performance_type: 'group', duration_seconds: 200, first_names: ['Priya', 'Amit'], path: 'p/a.m4a' }),
    ).toBe('002_BRIDE_PRIYA_AMIT_GROUP_03-20.m4a');
  });
  it('uses a group label when there are many performers', () => {
    expect(
      buildAudioFilename({ ...base, position: 3, performance_type: 'group', duration_seconds: 115, display_name: 'Family Group', first_names: ['A', 'B', 'C', 'D', 'E'] }),
    ).toBe('003_GROOM_FAMILY_GROUP_01-55.mp3');
  });
  it('pads order to 3+ digits and sanitizes names', () => {
    const f = buildAudioFilename({ ...base, position: 1234, first_names: ["D'Souza / Ann-Marie"] });
    expect(f).toBe('1234_GROOM_D_SOUZA_ANN_MARIE_SOLO_02-15.mp3');
    expect(f).toMatch(/^[A-Z0-9_\-.a-z]+$/);
  });
  it('falls back when names are not Latin', () => {
    expect(performerLabel({ first_names: ['प्रिया'], display_name: 'प्रिया', performance_type: 'solo' })).toBe('PERFORMER');
  });
  it('handles unknown duration and preserves the extension from the original name', () => {
    expect(buildAudioFilename({ ...base, position: 5, duration_seconds: null, path: null, original_filename: 'My Song.WAV', first_names: ['Neha'] })).toBe(
      '005_GROOM_NEHA_SOLO_00-00.wav',
    );
  });
});

describe('duration', () => {
  it('formats and parses', () => {
    expect(formatDuration(135)).toBe('02:15');
    expect(formatDuration(135, '-')).toBe('02-15');
    expect(parseDuration('2:15')).toBe(135);
    expect(parseDuration('135')).toBe(135);
    expect(parseDuration('2:75')).toBeNull();
  });
  it('flags clips over the threshold only', () => {
    expect(isOverLimit(181, 180)).toBe(true);
    expect(isOverLimit(180, 180)).toBe(false);
    expect(isOverLimit(null, 180)).toBe(false);
  });
});

describe('audio format detection', () => {
  it('resolves formats by extension then MIME', () => {
    expect(resolveAudioFormat('song.M4A')?.mime).toBe('audio/mp4');
    expect(resolveAudioFormat('noext', 'audio/x-wav')?.mime).toBe('audio/wav');
    expect(resolveAudioFormat('evil.exe', 'application/x-msdownload')).toBeNull();
  });
  it('sniffs magic bytes', () => {
    const wav = new TextEncoder().encode('RIFF\0\0\0\0WAVEfmt ');
    expect(sniffAudio(wav)).toBe('wav');
    expect(sniffAudio(new Uint8Array([0, 0, 0, 0x20, ...new TextEncoder().encode('ftypM4A ')]))).toBe('mp4');
    expect(sniffAudio(new Uint8Array([0xff, 0xfb, 0x90, 0x64]))).toBe('mp3');
    expect(sniffAudio(new Uint8Array([0xff, 0xf1, 0x50, 0x80]))).toBe('aac');
    expect(contentMatchesFormat(new TextEncoder().encode('<html><script>'), resolveAudioFormat('x.mp3')!)).toBe(false);
    expect(contentMatchesFormat(wav, resolveAudioFormat('x.mp3')!)).toBe(false);
  });
});

describe('WhatsApp message privacy', () => {
  const msg = buildProgressMessage({
    eventName: 'Ladies Sangeet',
    names: ['Rahul Sharma', 'Priya Verma', 'rahul  sharma', 'Amit Kumar'],
    appUrl: 'https://sangeet.pages.dev/',
  });
  it('lists unique names and both links', () => {
    expect(msg).toContain('🎉 Ladies Sangeet – Dance Updates 💃');
    expect(msg).toContain('1. Rahul Sharma');
    expect(msg).toContain('3. Amit Kumar');
    expect(msg.match(/Rahul Sharma/gi)).toHaveLength(1);
    expect(msg).toContain('https://sangeet.pages.dev/register');
    expect(msg).toContain('https://sangeet.pages.dev/tracker');
  });
  it('contains no song, order, audio or type details', () => {
    expect(msg).not.toMatch(/solo|group|\.mp3|audio|youtube|song title|#\d/i);
  });
  it('builds an encoded wa.me link', () => {
    const url = whatsappShareUrl('Hi & bye 🎉\nline');
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(url.split('text=')[1])).toBe('Hi & bye 🎉\nline');
  });
});

describe('hashing & tokens', () => {
  it('hashes with salt and verifies', async () => {
    const a = await hashSecret('4821', 1000);
    const b = await hashSecret('4821', 1000);
    expect(a).not.toBe(b);
    expect(a).not.toContain('4821');
    expect(await verifySecret('4821', a)).toBe(true);
    expect(await verifySecret('4822', a)).toBe(false);
    expect(await verifySecret('4821', 'garbage')).toBe(false);
  });
  it('makes unguessable tokens', async () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(randomToken());
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('validation', () => {
  it('validates names and PINs', () => {
    expect(validateName('Anne-Marie', 'First name')).toBeNull();
    expect(validateName('<script>', 'First name')).not.toBeNull();
    expect(validateNewPin('0000')).not.toBeNull();
    expect(validateNewPin('123')).not.toBeNull();
    expect(validateNewPin('1234')).toBeNull();
  });
  it('only accepts YouTube links', () => {
    expect(normalizeYouTubeUrl('http://youtu.be/abc')).toBe('https://youtu.be/abc');
    expect(normalizeYouTubeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeYouTubeUrl('https://evil.com/watch?v=1')).toBeNull();
  });
});
