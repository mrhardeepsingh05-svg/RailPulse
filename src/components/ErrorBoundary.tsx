import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F4F7FB] flex items-center justify-center p-6">
          <div role="alert" className="max-w-md w-full rounded-2xl border border-rose-200 bg-white p-6 shadow-sm text-center space-y-3">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-50 text-rose-700">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </div>
            <h1 className="text-base font-bold text-[#1E3A5F]">Something went wrong</h1>
            <p className="text-xs text-slate-600">
              This page ran into an unexpected display error. Your saved data is safe.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#1E3A5F] px-4 py-2 text-xs font-semibold text-white hover:bg-[#284B78]"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
