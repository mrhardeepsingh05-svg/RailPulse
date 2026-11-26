import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, AlertTriangle, CalendarClock, ClipboardCheck, ShieldAlert, Wrench } from 'lucide-react';
import { CardSkeleton, EmptyState, EstimateBadge, ProvenanceBadge, StatusBadge } from '../components/ui/Badges';
import { api } from '../lib/api';
import type { PredictiveMaintenancePayload } from '../types';

export function PredictivePage() {
  const navigate = useNavigate();
  const [data, setData] = useState<PredictiveMaintenancePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .get<PredictiveMaintenancePayload>('/api/predictive')
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Could not load predictive estimates.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <CardSkeleton rows={6} />;

  if (error || !data) {
    return (
      <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
        {error || 'Predictive maintenance estimates are not available right now.'}
      </div>
    );
  }

  if (data.asset_estimates.length === 0) {
    return (
      <EmptyState
        icon={<Activity className="h-5 w-5" aria-hidden="true" />}
        title="Not enough records to build estimates"
        description="Add railway assets and complete inspections first so RailPulse AI has real history to review."
        action={
          <button
            type="button"
            onClick={() => navigate('/assets')}
            className="rounded-xl bg-[#1E3A5F] px-4 py-2 text-xs font-semibold text-white hover:bg-[#284B78]"
          >
            Go to Railway Assets
          </button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Honest Data Provenance & Safety Notice */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <EstimateBadge />
            <span className="text-xs font-bold text-[#1E3A5F]">Transparent Rule-Based Maintenance Estimates</span>
          </div>
          <p className="text-xs text-slate-700">{data.safety_disclaimer}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => navigate('/inspections')}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#1E3A5F] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#284B78]"
          >
            <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Record Check
          </button>
          <button
            type="button"
            onClick={() => navigate('/maintenance')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
            Maintenance Tasks
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <p className="text-xs text-slate-500">High Watch Assets</p>
          <p className="mt-1 text-2xl font-bold text-rose-700 tabular-nums">{data.summary.high_watch_count}</p>
          <p className="text-[11px] text-slate-500 mt-1">Need early engineering follow-up</p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <p className="text-xs text-slate-500">Overdue Inspections</p>
          <p className="mt-1 text-2xl font-bold text-amber-700 tabular-nums">{data.summary.overdue_inspections_count}</p>
          <p className="text-[11px] text-slate-500 mt-1">Past their planned next check date</p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <p className="text-xs text-slate-500">Repeated Issues</p>
          <p className="mt-1 text-2xl font-bold text-[#1E3A5F] tabular-nums">{data.summary.repeated_issue_assets_count}</p>
          <p className="text-[11px] text-slate-500 mt-1">Assets with repeat faults or repairs</p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <p className="text-xs text-slate-500">Data Availability</p>
          <p className="mt-1 text-2xl font-bold text-sky-700 tabular-nums">
            {data.summary.sufficient_assets}/{data.summary.total_assets_evaluated}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            {data.summary.insufficient_data_assets} marked Insufficient Data
          </p>
        </div>
      </div>

      {/* Main Predictive Estimates Table */}
      <section className="rounded-2xl border border-slate-200/80 bg-white overflow-hidden shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-sm font-bold text-[#1E3A5F]">Asset Priority &amp; Maintenance Watchlist</h2>
            <p className="text-xs text-slate-500">
              Shows prediction basis, data availability, confidence level, and recommended next inspection step.
            </p>
          </div>
          <EstimateBadge />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-[#F4F7FB] text-slate-600 font-semibold uppercase">
                <th className="px-4 py-3">Asset</th>
                <th className="px-4 py-3">Watch Level &amp; Score</th>
                <th className="px-4 py-3">Data Availability &amp; Confidence</th>
                <th className="px-4 py-3">Prediction Basis (Saved Records)</th>
                <th className="px-4 py-3">Recommended Follow-Up</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.asset_estimates.map((asset) => (
                <tr key={asset.id} className="align-top hover:bg-slate-50/70">
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <code className="font-bold text-[#1E3A5F]">{asset.asset_code}</code>
                      <ProvenanceBadge isDemo={asset.is_demo} />
                    </div>
                    <p className="font-semibold text-slate-900 mt-0.5">{asset.name}</p>
                    <p className="text-[11px] text-slate-500">{asset.category_name} · {asset.section_location}</p>
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap space-y-1.5">
                    <div><StatusBadge value={asset.risk_level} /></div>
                    <p className="text-[11px] text-slate-600 tabular-nums">
                      {asset.risk_score !== null ? `Rule Score: ${asset.risk_score}/100` : 'No estimate (0 history records)'}
                    </p>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="font-semibold text-slate-800">{asset.data_availability}</span>
                    <p className="text-[11px] text-slate-600 mt-0.5">{asset.confidence}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                      {asset.inspection_count} checks · {asset.fault_count} faults · {asset.total_work_orders} tasks
                    </p>
                  </td>
                  <td className="px-4 py-3.5 min-w-56">
                    <ul className="list-disc pl-4 space-y-0.5 text-slate-700">
                      {asset.prediction_basis.map((b, idx) => (
                        <li key={idx}>{b}</li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-4 py-3.5 min-w-48">
                    <p className="text-slate-800 font-medium">{asset.recommended_action}</p>
                    {asset.overdue_days > 0 && (
                      <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700">
                        <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                        Overdue by {asset.overdue_days} day(s)
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Overdue Inspections + Frequent Faults + Transparent Rules */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs space-y-3">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-amber-600" aria-hidden="true" />
            <h2 className="text-sm font-bold text-[#1E3A5F]">Overdue Inspections</h2>
          </div>
          {data.overdue_inspections.length === 0 ? (
            <p className="text-xs text-slate-500 py-4">No overdue inspections right now.</p>
          ) : (
            <ul className="space-y-2.5 text-xs">
              {data.overdue_inspections.map((o) => (
                <li key={o.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <code className="font-bold text-[#1E3A5F]">{o.asset_code}</code>
                    <span className="font-bold text-rose-700 tabular-nums">{o.days_overdue}d overdue</span>
                  </div>
                  <p className="font-semibold text-slate-900 mt-0.5">{o.name}</p>
                  <p className="text-[11px] text-slate-600">Due {o.next_inspection_date} · {o.section_location}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-600" aria-hidden="true" />
            <h2 className="text-sm font-bold text-[#1E3A5F]">Assets with Frequent Faults</h2>
          </div>
          {data.frequent_fault_assets.length === 0 ? (
            <p className="text-xs text-slate-500 py-4">No repeated faults recorded yet.</p>
          ) : (
            <ul className="space-y-2.5 text-xs">
              {data.frequent_fault_assets.map((f) => (
                <li key={f.id} className="rounded-xl border border-slate-200 bg-[#F4F7FB] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <code className="font-bold text-[#1E3A5F]">{f.asset_code}</code>
                    <span className="font-semibold text-slate-800 tabular-nums">{f.fault_count} fault(s)</span>
                  </div>
                  <p className="font-semibold text-slate-900 mt-0.5">{f.name}</p>
                  <p className="text-[11px] text-slate-600">
                    {f.open_fault_count} open · {f.critical_fault_count} critical · {f.category_name}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs space-y-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-[#7C3AED]" aria-hidden="true" />
            <h2 className="text-sm font-bold text-[#1E3A5F]">How Scores Are Calculated</h2>
          </div>
          <p className="text-xs text-slate-500">Transparent rule weights (no hidden black-box guesses):</p>
          <ul className="space-y-2 text-xs">
            {data.rules_documentation.map((rule) => (
              <li key={rule.factor} className="rounded-xl border border-slate-100 bg-slate-50 p-2.5">
                <div className="flex items-center justify-between gap-2 font-semibold text-slate-800">
                  <span>{rule.factor}</span>
                  <span className="text-[#7C3AED] tabular-nums">{rule.points}</span>
                </div>
                <p className="text-[11px] text-slate-600 mt-0.5">{rule.meaning}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
