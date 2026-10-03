import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches renderer render/effect errors and shows a visible message with a
 * reload action instead of leaving a permanent white window.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("ParthSeva renderer error:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="center-note" style={{ minHeight: "100vh", padding: 24 }}>
          <div className="card" style={{ maxWidth: 560, textAlign: "center" }}>
            <div className="card-label">Something went wrong</div>
            <p className="card-sub">{this.state.error.message}</p>
            <button className="btn primary" onClick={() => window.location.reload()}>
              Reload app
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
