// Safety net: if any screen crashes, show a friendly message with a reload
// button instead of a blank page.
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  failed: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Screen crashed', error.message, info.componentStack?.slice(0, 500));
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="mx-auto max-w-md px-4 pt-16 text-center">
        <p className="text-4xl" aria-hidden>
          🙏
        </p>
        <h1 className="mt-3 text-2xl font-bold">Something went wrong</h1>
        <p className="mt-2 text-stone-600">Please reload the page. If it keeps happening, tell the organiser.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-6 min-h-12 w-full rounded-xl bg-rose-700 px-4 text-lg font-semibold text-white active:bg-rose-800"
        >
          Reload
        </button>
        <a href="/" className="mt-3 inline-flex min-h-11 items-center font-semibold text-rose-700 underline">
          Go to the home page
        </a>
      </main>
    );
  }
}
