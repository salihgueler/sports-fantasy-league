import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { SignIn } from './pages/SignIn';
import { SignUp } from './pages/SignUp';
import { VerifyEmail } from './pages/VerifyEmail';
import { ProtectedRoute } from './components/ProtectedRoute';
import { scheduleTokenRefresh } from './lib/auth';
import { useAuthStore } from './stores/auth-store';
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/jetbrains-mono';
import './index.css';

// Lazy-loaded route pages for code splitting
const CompetitionList = lazy(() =>
  import('./pages/CompetitionList').then((m) => ({ default: m.CompetitionList })),
);
const CompetitionDetail = lazy(() =>
  import('./pages/CompetitionDetail').then((m) => ({ default: m.CompetitionDetail })),
);
const CreateLeague = lazy(() =>
  import('./pages/CreateLeague').then((m) => ({ default: m.CreateLeague })),
);
const JoinLeague = lazy(() =>
  import('./pages/JoinLeague').then((m) => ({ default: m.JoinLeague })),
);
const DraftRoom = lazy(() => import('./pages/DraftRoom').then((m) => ({ default: m.DraftRoom })));
const SquadBuilder = lazy(() =>
  import('./pages/SquadBuilder').then((m) => ({ default: m.SquadBuilder })),
);
const MyTeams = lazy(() => import('./pages/MyTeams').then((m) => ({ default: m.MyTeams })));
const MyLeagues = lazy(() => import('./pages/MyLeagues').then((m) => ({ default: m.MyLeagues })));
const LeagueStandings = lazy(() =>
  import('./pages/LeagueStandings').then((m) => ({ default: m.LeagueStandings })),
);
const LiveDashboard = lazy(() =>
  import('./pages/LiveDashboard').then((m) => ({ default: m.LiveDashboard })),
);
const LeagueChat = lazy(() =>
  import('./pages/LeagueChat').then((m) => ({ default: m.LeagueChat })),
);
const Transfers = lazy(() => import('./pages/Transfers').then((m) => ({ default: m.Transfers })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

// On app boot, schedule token refresh if the user has a session
const { tokens } = useAuthStore.getState();
if (tokens) {
  scheduleTokenRefresh();
}

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route path="/sign-in" element={<SignIn />} />
          <Route path="/sign-up" element={<SignUp />} />
          <Route path="/verify" element={<VerifyEmail />} />

          {/* Protected routes */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <App />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/competitions" replace />} />
            <Route
              path="teams"
              element={
                <Suspense fallback={<LoadingFallback />}>
                  <MyTeams />
                </Suspense>
              }
            />
            <Route
              path="competitions"
              element={
                <Suspense fallback={<LoadingFallback />}>
                  <CompetitionList />
                </Suspense>
              }
            />
            <Route
              path="competitions/:id"
              element={
                <Suspense fallback={<LoadingFallback />}>
                  <CompetitionDetail />
                </Suspense>
              }
            />
            <Route
              path="leagues"
              element={
                <Suspense fallback={<LoadingFallback />}>
                  <MyLeagues />
                </Suspense>
              }
            />
            <Route
              path="leagues/create"
              element={
                <Suspense fallback={<LoadingFallback />}>
                  <CreateLeague />
                </Suspense>
              }
            />
            <Route
              path="leagues/join"
              element={
                <Suspense fallback={<LoadingFallback />}>
                  <JoinLeague />
                </Suspense>
              }
            />
            <Route
              path="competitions/:competitionId/draft"
              element={
                <Suspense fallback={<LoadingFallback />}>
                  <DraftRoom />
                </Suspense>
              }
            />
            <Route
              path="teams/:fantasyTeamId/manage"
              element={
                <Suspense fallback={<LoadingFallback />}>
                  <SquadBuilder />
                </Suspense>
              }
            />
            <Route
              path="leagues/:leagueId/standings"
              element={
                <Suspense fallback={<LoadingFallback />}>
                  <LeagueStandings />
                </Suspense>
              }
            />
            <Route
              path="live/:competitionId"
              element={
                <Suspense fallback={<LoadingFallback />}>
                  <LiveDashboard />
                </Suspense>
              }
            />
            <Route
              path="leagues/:leagueId/chat"
              element={
                <Suspense fallback={<LoadingFallback />}>
                  <LeagueChat />
                </Suspense>
              }
            />
            <Route
              path="teams/:fantasyTeamId/transfers"
              element={
                <Suspense fallback={<LoadingFallback />}>
                  <Transfers />
                </Suspense>
              }
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
