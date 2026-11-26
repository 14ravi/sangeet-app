import { Navigate, Route, Routes } from 'react-router';
import { isConfigured } from './lib/api';
import { HomePage } from './participant/HomePage';
import { RegisterPage } from './participant/RegisterPage';
import { LoginPage } from './participant/LoginPage';
import { ChangePinPage } from './participant/ChangePinPage';
import { ParticipantLayout } from './participant/ParticipantLayout';
import { TrackerPage } from './participant/TrackerPage';
import { MyPerformancesPage } from './participant/MyPerformancesPage';
import { AdminLoginPage } from './admin/AdminLoginPage';
import { AdminLayout } from './admin/AdminLayout';
import { DashboardPage } from './admin/DashboardPage';
import { PeoplePage } from './admin/PeoplePage';
import { PersonPage } from './admin/PersonPage';
import { PerformancesPage } from './admin/PerformancesPage';
import { PerformancePage } from './admin/PerformancePage';
import { PerformanceFormPage } from './admin/PerformanceFormPage';
import { SongsPage } from './admin/SongsPage';
import { SongPage } from './admin/SongPage';
import { RunningOrderPage } from './admin/RunningOrderPage';
import { SettingsPage } from './admin/SettingsPage';

export default function App() {
  if (!isConfigured) {
    return (
      <main className="mx-auto max-w-lg p-6">
        <h1 className="text-2xl font-bold">Setup needed</h1>
        <p className="mt-3 text-stone-700">
          This build is missing <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>. Add them in
          Cloudflare Pages → Settings → Environment variables and redeploy (see README).
        </p>
      </main>
    );
  }
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-pin" element={<ChangePinPage />} />
      <Route element={<ParticipantLayout />}>
        <Route path="/tracker" element={<TrackerPage />} />
        <Route path="/my" element={<MyPerformancesPage />} />
      </Route>

      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="people" element={<PeoplePage />} />
        <Route path="people/new" element={<PersonPage isNew />} />
        <Route path="people/:id" element={<PersonPage />} />
        <Route path="performances" element={<PerformancesPage />} />
        <Route path="performances/new" element={<PerformanceFormPage />} />
        <Route path="performances/:id" element={<PerformancePage />} />
        <Route path="performances/:id/edit" element={<PerformanceFormPage />} />
        <Route path="songs" element={<SongsPage />} />
        <Route path="songs/:key" element={<SongPage />} />
        <Route path="live" element={<RunningOrderPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
