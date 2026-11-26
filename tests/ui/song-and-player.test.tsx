// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.stubEnv('VITE_SUPABASE_URL', 'http://api.test');
vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-key');

const perf = (id: string, name: string, title: string, url: string | null) => ({
  id,
  display_name: name,
  side: 'bride',
  performance_type: 'group',
  song_title: title,
  normalized_song_title: 'kala chashma',
  artist: null,
  youtube_url: url,
  has_audio: true,
  original_filename: 'x.mp3',
  audio_mime_type: 'audio/mpeg',
  duration_seconds: 95,
  audio_uploaded_at: '2026-11-26T00:00:00Z',
  admin_notes: null,
  preparation_status: 'draft',
  live_status: 'pending',
  sort_order: 1,
  position: 1,
  version: 1,
  created_at: '',
  updated_at: '',
  participants: [{ id: 'pp-' + id, first_name: 'Neha', last_name: name, side: 'bride', is_active: true }],
});

let calls: { route: string; body: Record<string, unknown> }[] = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const route = String(url).split('/functions/v1/api/')[1];
    const body = JSON.parse(String(init.body ?? '{}'));
    calls.push({ route, body });
    let data: unknown = {};
    if (route === 'admin/songs/get') {
      data = {
        items: [perf('p1', 'Girls', 'Kala Chashma', 'https://youtu.be/a'), perf('p2', 'Boys', 'kala chashma!', 'https://youtu.be/b')],
        max_duration_seconds: 180,
      };
    }
    if (route === 'admin/audio/url') data = { url: `http://storage.test/signed/${body.performance_id}.mp3`, filename: 'f.mp3' };
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('song detail page', () => {
  it('lists every performance with the same normalized title and plays the exact clip of each', async () => {
    const { SongPage } = await import('../../src/admin/SongPage');
    const { ToastProvider } = await import('../../src/components/ui');
    render(
      <MemoryRouter initialEntries={['/admin/songs/kala%20chashma']}>
        <ToastProvider>
          <Routes>
            <Route path="/admin/songs/:key" element={<SongPage />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Girls')).toBeTruthy();
    expect(screen.getByText('Boys')).toBeTruthy();
    expect(screen.getByText(/Possible duplicate/)).toBeTruthy();
    expect(calls.find((c) => c.route === 'admin/songs/get')?.body).toEqual({ key: 'kala chashma' });
    // nothing is preloaded: no audio URL requested yet
    expect(calls.some((c) => c.route === 'admin/audio/url')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Play Boys' }));
    await waitFor(() => expect(calls.some((c) => c.route === 'admin/audio/url')).toBe(true));
    const req = calls.find((c) => c.route === 'admin/audio/url')!;
    expect(req.body).toEqual({ performance_id: 'p2', purpose: 'play' });
    await waitFor(() => {
      const srcs = [...document.querySelectorAll('audio')].map((a) => a.getAttribute('src') ?? (a as HTMLAudioElement).src);
      expect(srcs).toContain('http://storage.test/signed/p2.mp3');
    });
    // each result links to its performance detail
    expect(screen.getByText('Girls').closest('a')?.getAttribute('href')).toBe('/admin/performances/p1');
  });
});
