import React, { useEffect, useState } from 'react';
import { AlertCircle, ShieldCheck, TrainTrack, UserCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../lib/api';
import type { DemoAccountHint } from '../types';

const DEMO_PASSWORDS: Record<string, string> = {
  'admin.demo': 'Admin@2026!',
  'inspector.demo': 'Inspector@2026!',
  'engineer.demo': 'Engineer@2026!',
  'staff.demo': 'Staff@2026!',
};

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demoAccounts, setDemoAccounts] = useState<DemoAccountHint[]>([]);

  useEffect(() => {
    api
      .get<{ enabled: boolean; accounts: DemoAccountHint[] }>('/api/auth/demo-accounts')
      .then((res) => {
        if (res.enabled) setDemoAccounts(res.accounts);
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError('Please enter both your username and password.');
      return;
    }
    setSubmitting(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in right now. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDemoFill = (acct: DemoAccountHint) => {
    setUsername(acct.username);
    setPassword(DEMO_PASSWORDS[acct.username] || '');
    setError(null);
  };

  return (
    <main className="min-h-screen bg-[#F4F7FB] flex flex-col justify-center py-10 px-4 sm:px-6">
      <div className="mx-auto w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <section className="lg:col-span-6 rounded-2xl bg-[#1E3A5F] text-white p-7 sm:p-8 flex flex-col justify-between shadow-lg">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#3B82F6]">
                <TrainTrack className="h-5 w-5 text-white" aria-hidden="true" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">RailPulse AI</h1>
                <p className="text-xs text-sky-200">Smarter Inspections. Better Maintenance. Reliable Railways.</p>
              </div>
            </div>

            <h2 className="mt-8 text-lg font-semibold text-white">
              Simple Railway Asset &amp; Maintenance Care
            </h2>
            <p className="mt-2 text-sm text-sky-100 leading-relaxed">
              Keep track of railway tracks, bridges, stations, signals, and crossings in one easy place.
              Record photo inspections, check AI findings, assign repairs, and download clear reports.
            </p>

            <ul className="mt-6 space-y-3 text-xs text-sky-100">
              <li className="flex items-start gap-2.5">
                <ShieldCheck className="h-4 w-4 text-emerald-300 shrink-0 mt-0.5" aria-hidden="true" />
                <span>Clear access rules for Admin, Inspector, Engineer, and Maintenance Staff</span>
              </li>
              <li className="flex items-start gap-2.5">
                <ShieldCheck className="h-4 w-4 text-emerald-300 shrink-0 mt-0.5" aria-hidden="true" />
                <span>AI inspection helper always asks a qualified person to confirm findings</span>
              </li>
              <li className="flex items-start gap-2.5">
                <ShieldCheck className="h-4 w-4 text-emerald-300 shrink-0 mt-0.5" aria-hidden="true" />
                <span>Live database counts, verified asset map markers, calendar, and PDF reports</span>
              </li>
            </ul>
          </div>

          <div className="mt-8 rounded-xl border border-white/15 bg-white/10 p-3.5 text-[11px] text-sky-100">
            <strong className="text-white">Please Note:</strong> This tool supports railway maintenance teams and does not
            replace human safety inspections. It claims no official Indian Railways deployment or endorsement.
          </div>
        </section>

        <section className="lg:col-span-6 rounded-2xl border border-slate-200 bg-white p-7 sm:p-8 shadow-sm flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-bold text-[#1E3A5F]">Sign In</h2>
            <p className="mt-1 text-xs text-slate-600">
              Enter your account details to open your workspace.
            </p>

            {error && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700"
              >
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={(e) => void handleSubmit(e)} className="mt-5 space-y-4">
              <div>
                <label htmlFor="login-username" className="block text-xs font-semibold text-slate-700">
                  Username
                </label>
                <input
                  id="login-username"
                  type="text"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. inspector.demo"
                  className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="login-password" className="block text-xs font-semibold text-slate-700">
                  Password
                </label>
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-[#1E3A5F] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#284B78] disabled:opacity-60 transition-colors"
              >
                {submitting ? 'Signing In...' : 'Sign In'}
              </button>
            </form>
          </div>

          {demoAccounts.length > 0 && (
            <div className="mt-6 border-t border-slate-200 pt-5">
              <div className="flex items-center justify-between mb-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#1E3A5F]">
                  <UserCheck className="h-4 w-4 text-[#7C3AED]" aria-hidden="true" />
                  Demo Login Accounts
                </span>
                <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700">
                  DEMO MODE
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mb-2.5">
                Click any role below to fill test details, then click Sign In:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {demoAccounts.map((acct) => (
                  <button
                    key={acct.username}
                    type="button"
                    onClick={() => handleDemoFill(acct)}
                    className="text-left rounded-xl border border-slate-200 bg-[#F4F7FB] px-3 py-2 hover:border-[#2563EB] hover:bg-sky-50 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-semibold text-[#1E3A5F]">{acct.role_display}</span>
                    </div>
                    <code className="text-[10px] text-sky-700 font-mono block">{acct.username}</code>
                    <p className="text-[10px] text-slate-600 mt-0.5 line-clamp-2">{acct.summary}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
