import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[#1a1a2e] text-slate-200 p-8">
          <h1 className="text-2xl font-semibold">Bir hata oluştu</h1>
          <p className="text-slate-400 text-sm max-w-md text-center">
            Sayfa yüklenirken beklenmeyen bir hata aldı. Tekrar denemek için aşağıdaki butonu kullanabilirsiniz.
          </p>
          {import.meta.env.DEV && this.state.error && (
            <pre className="bg-slate-900 border border-slate-700 rounded p-4 text-xs text-red-400 max-w-2xl overflow-auto">
              {this.state.error.message}
            </pre>
          )}
          <div className="flex gap-3 mt-2">
            <button
              onClick={this.handleReset}
              className="px-4 py-2 bg-slate-700 text-white rounded text-sm hover:bg-slate-600"
            >
              Tekrar dene
            </button>
            <button
              onClick={this.handleReload}
              className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
            >
              Sayfayı yenile
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
