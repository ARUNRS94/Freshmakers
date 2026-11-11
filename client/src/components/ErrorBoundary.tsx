import { Component, type ReactNode } from 'react';

/** Keeps one broken screen from blanking the whole app; the menu stays usable */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card card-body stack" role="alert">
        <h3>Something went wrong on this screen</h3>
        <p className="muted">Your other work is safe. Reload the page, or choose another screen from the menu.</p>
        <div><button className="btn" onClick={() => window.location.reload()}>Reload</button></div>
      </div>
    );
  }
}
