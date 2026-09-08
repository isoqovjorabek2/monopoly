import { Component, type ErrorInfo, type ReactNode } from 'react';

/* Without this, any throw during render unmounts the whole tree and the
 * player is left staring at a blank page with no idea what happened and
 * no way back. A crash should still be a designed state. */

interface Props {
  children: ReactNode;
  /**
   * Renders instead of the full-page crash screen. Used to contain a
   * failure to the part that failed - a dead 3D canvas should cost the
   * board, not the game everyone is in the middle of.
   */
  fallback?: (error: Error) => ReactNode;
  onError?: (error: Error) => void;
}
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the detail in the console for anyone who opens devtools.
    console.error('Monopoly Royale crashed:', error, info.componentStack);
    this.props.onError?.(error);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error);

    return (
      <div className="crash">
        <div className="card crash__card">
          <h1 className="section__title">Something broke</h1>
          <p className="muted">
            The game hit an error it could not recover from. Reloading starts a
            fresh table - an in-progress game cannot be restored, because the
            state only ever lived in the host&apos;s browser.
          </p>
          <pre className="crash__detail">{error.message}</pre>
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={() => {
              window.location.hash = '';
              window.location.reload();
            }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
