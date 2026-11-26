import type { LiveStatus, PerformanceType, PreparationStatus, Side } from '@shared/validation.ts';

export type { LiveStatus, PerformanceType, PreparationStatus, Side };

export interface PerformerRef {
  id: string;
  first_name: string;
  last_name: string;
  side: Side | null;
  is_active: boolean;
}

export interface Performance {
  id: string;
  display_name: string;
  side: Side;
  performance_type: PerformanceType;
  song_title: string;
  normalized_song_title: string;
  artist: string | null;
  youtube_url: string | null;
  has_audio: boolean;
  original_filename: string | null;
  audio_mime_type: string | null;
  duration_seconds: number | null;
  audio_uploaded_at: string | null;
  admin_notes: string | null;
  preparation_status: PreparationStatus;
  live_status: LiveStatus;
  sort_order: number;
  position: number;
  version: number;
  created_at: string;
  updated_at: string;
  participants: PerformerRef[];
}

export interface AccountInfo {
  id: string;
  phone: string;
  first_name: string;
  last_name: string;
  email: string | null;
  registered_at: string;
  last_login_at: string | null;
  blocked: boolean;
  blocked_at: string | null;
  must_change_pin: boolean;
  temp_pin_expires_at: string | null;
}

export interface Participant {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  side: Side | null;
  is_active: boolean;
  created_via: 'admin' | 'registration';
  created_at: string;
  updated_at: string;
  performance_count: number;
  account: AccountInfo | null;
}

export interface PendingAccount {
  id: string;
  phone: string;
  first_name: string;
  last_name: string;
  email: string | null;
  registered_at: string;
  blocked: boolean;
  candidates: { id: string; first_name: string; last_name: string; side: Side | null }[];
}

export interface RunningOrder {
  unchanged: boolean;
  data_version: number;
  order_revision: number;
  max_duration_seconds?: number;
  items?: Performance[];
}

export interface Settings {
  event_name: string;
  registration_enabled: boolean;
  max_duration_seconds: number;
  public_app_url: string | null;
  admin_username: string | null;
  updated_at: string;
}
