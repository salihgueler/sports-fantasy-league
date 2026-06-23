import { NavLink, useNavigate, useLocation, Outlet, Link } from 'react-router-dom';
import { Trophy, Users, Shield, LogOut } from 'lucide-react';
import { useAuthStore } from './stores/auth-store';
import { logout, clearScheduledRefresh } from './lib/auth';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Button } from './components/ui/button';
import { cn } from './lib/utils';

const navItems = [
  { to: '/competitions', label: 'Competitions', icon: Trophy },
  { to: '/teams', label: 'My Teams', icon: Users },
  { to: '/leagues', label: 'My Leagues', icon: Shield },
];

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);

  function handleSignOut() {
    logout();
    clearScheduledRefresh();
    navigate('/sign-in', { replace: true });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/70">
        <nav
          aria-label="Main navigation"
          className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:gap-6 sm:px-6"
        >
          <Link to="/competitions" className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-primary font-display text-sm font-bold text-primary-foreground">
              FL
            </span>
            <span className="hidden font-display text-lg font-bold tracking-tight sm:inline">
              Fantasy League
            </span>
          </Link>

          <ul className="flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      cn(
                        'inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-secondary text-primary'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      )
                    }
                  >
                    <Icon className="h-4 w-4" />
                    <span className="hidden sm:inline">{item.label}</span>
                  </NavLink>
                </li>
              );
            })}
          </ul>

          <div className="ml-auto flex items-center gap-3">
            {user?.email && (
              <span className="hidden max-w-[16rem] truncate text-sm text-muted-foreground md:inline">
                {user.email}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </nav>
        <div className="tricolor-stripe" aria-hidden="true" />
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <ErrorBoundary key={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}
