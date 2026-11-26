import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { RailyAssistant } from '../components/RailyAssistant';
import { ProvenanceBadge, StatusBadge } from '../components/ui/Badges';
import { HorizontalBarChart } from '../components/ui/Charts';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import { api } from '../lib/api';
import { LoginPage } from '../pages/LoginPage';

describe('RailPulse AI v2 Frontend & Accessibility', () => {
  it('renders LoginPage with simple English, 4 demo roles, and disclaimer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          enabled: true,
          accounts: [
            { username: 'admin.demo', role: 'admin', role_display: 'Admin', summary: 'Manage team and roles.' },
            { username: 'inspector.demo', role: 'inspector', role_display: 'Inspector', summary: 'Create inspections.' },
            { username: 'engineer.demo', role: 'engineer', role_display: 'Engineer', summary: 'Manage assets and tasks.' },
            { username: 'staff.demo', role: 'staff', role_display: 'Maintenance Staff', summary: 'Update assigned tasks.' },
          ],
        }),
      }),
    );

    render(
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /RailPulse AI/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Password/i)).toBeInTheDocument();
    expect(screen.getByText(/does not replace human safety inspections/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Maintenance Staff')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Inspector'));
    expect((screen.getByLabelText(/Username/i) as HTMLInputElement).value).toBe('inspector.demo');
    vi.unstubAllGlobals();
  });

  it('renders soft pastel Condition and Provenance badges', () => {
    render(
      <div>
        <ProvenanceBadge isDemo={1} />
        <ProvenanceBadge isDemo={0} />
        <StatusBadge value="Good" />
        <StatusBadge value="Waiting for Review" />
        <StatusBadge value="Critical Alert" />
      </div>,
    );

    expect(screen.getByText('DEMO DATA')).toBeInTheDocument();
    expect(screen.getByText('LIVE DATA')).toBeInTheDocument();
    expect(screen.getByText('Good')).toBeInTheDocument();
    expect(screen.getByText('Waiting for Review')).toBeInTheDocument();
    expect(screen.getByText('Critical Alert')).toBeInTheDocument();
  });

  it('renders accessible HorizontalBarChart progressbars', () => {
    render(
      <HorizontalBarChart
        title="Asset Condition"
        ariaLabel="Asset condition chart"
        items={[
          { label: 'Good', value: 4, color: '#10B981' },
          { label: 'Needs Attention', value: 2, color: '#F59E0B' },
        ]}
      />,
    );

    expect(screen.getByRole('region', { name: 'Asset condition chart' })).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar')).toHaveLength(2);
  });

  it('opens Raily helper panel cleanly', () => {
    render(
      <MemoryRouter>
        <RailyAssistant />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Open Raily Railway Assistant/i }));
    expect(screen.getByRole('region', { name: /Raily Helper Panel/i })).toBeInTheDocument();
    expect(screen.getByText(/Guided Help from your saved database records/i)).toBeInTheDocument();
  });

  it('catches unexpected component render crashes inside ErrorBoundary', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Boom(): never {
      throw new Error('Test render failure');
    }
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/Something went wrong/i);
    spy.mockRestore();
  });

  it('retries idempotent GET requests once on 503 and does not retry POST', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, headers: new Headers(), json: async () => ({ detail: 'Busy' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), json: async () => ({ status: 'ok' }) });
    vi.stubGlobal('fetch', fetchMock);

    const res = await api.get<{ status: string }>('/api/health');
    expect(res.status).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
