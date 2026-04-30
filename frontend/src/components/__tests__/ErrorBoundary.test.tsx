import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary';

function Boom(): React.ReactNode {
  throw new Error('kaboom');
}

function Safe() {
  return <div data-testid="safe-child">child rendered</div>;
}

describe('ErrorBoundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // React logs errors to console.error when an error boundary catches —
    // suppress to keep test output clean.
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <Safe />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('safe-child')).toBeInTheDocument();
  });

  it('renders the fallback UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/Bir hata oluştu/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Tekrar dene/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Sayfayı yenile/i }),
    ).toBeInTheDocument();
  });

  it('calls window.location.reload when "Sayfayı yenile" is clicked', () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, reload: reloadSpy },
    });

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Sayfayı yenile/i }));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});
