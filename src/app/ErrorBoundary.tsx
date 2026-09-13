/**
 * The last line of defence.
 *
 * A React error anywhere under this renders a blank white page by default, which on
 * a dark-themed site looks exactly like a broken deployment and tells the reader
 * nothing. A validation engineer who hits a bug should get the error, the module it
 * happened in, and the link that reproduces it - that link is the entire bug report.
 *
 * A class component, because that is the only thing React gives an error boundary.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The console is the only reporting channel this site has, by design: it is
    // static, it makes no network calls and it has nowhere to send a report to.
    console.error('Unhandled error in', info.componentStack, error);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-h2" style={{ color: 'var(--fail)' }}>
          Something in this page threw
        </h1>
        <p className="mt-3 text-body text-lo">
          This is a defect, not a setup you got wrong. The link in your address bar reproduces it exactly - it
          carries the whole scenario - so it is worth keeping.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-sm border border-rule bg-ink-800 p-3 text-micro text-hi">
          {error.message}
        </pre>
        <p className="mt-4 flex gap-3">
          <button
            type="button"
            className="rounded-sm border border-rule px-3 py-1 text-micro text-hi"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
          <a className="rounded-sm border border-rule px-3 py-1 text-micro no-underline" href="#/">
            Back to the contents
          </a>
        </p>
      </main>
    );
  }
}
