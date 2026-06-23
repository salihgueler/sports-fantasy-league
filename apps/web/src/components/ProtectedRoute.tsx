import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/auth-store';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, tokens } = useAuthStore();
  const location = useLocation();

  if (!user || !tokens) {
    return <Navigate to="/sign-in" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
