import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors in the routed content so a single bad component or
 * malformed API payload shows a recoverable message instead of unmounting the
 * entire app to a blank screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="mx-auto max-w-2xl rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive"
        >
          <h2 className="mb-2 font-display text-base font-semibold">
            Something went wrong on this page
          </h2>
          <p className="mb-4 break-words">{this.state.error.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-destructive px-3 py-1.5 font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
          >
            Reload page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
