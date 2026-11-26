import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { CardSkeleton, EmptyState, ProvenanceBadge, StatusBadge } from '../components/ui/Badges';
import { HorizontalBarChart, InspectionTrendChart } from '../components/ui/Charts';
import { api } from '../lib/api';
import type { AnalyticsOverview } from '../types';

export function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<AnalyticsOverview>('/api/analytics')
      .then((res) => setData(res))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <CardSkeleton rows={6} />;
  if (!data) {
    return (
      <EmptyState
        icon={<BarChart3 className="h-5 w-5" aria-hidden="true" />}
        title="No analytics data available yet"
        description="Add railway assets, submit inspections, or create maintenance tasks to view live trends."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <p className="text-xs text-slate-500">Maintenance Completion Rate</p>
          <p className="mt-1 text-2xl font-bold text-emerald-700 tabular-nums">{data.maintenance_completion.completion_rate_pct}%</p>
          <p className="text-[11px] text-slate-500 mt-1">
            {data.maintenance_completion.completed_tasks} of {data.maintenance_completion.total_tasks} tasks finished
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <p className="text-xs text-slate-500">Open vs Completed Tasks</p>
          <p className="mt-1 text-2xl font-bold text-[#1E3A5F] tabular-nums">
            {data.maintenance_completion.open_tasks} open / {data.maintenance_completion.completed_tasks} done
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Calculated directly from saved maintenance tasks</p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <p className="text-xs text-slate-500">Inspection Months Tracked</p>
          <p className="mt-1 text-2xl font-bold text-sky-700 tabular-nums">{data.monthly_inspections.length}</p>
          <p className="text-[11px] text-slate-500 mt-1">Active months with inspection records</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <section className="lg:col-span-7 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <h2 className="text-sm font-bold text-[#1E3A5F] mb-1">Monthly Inspection Activity</h2>
          <p className="text-xs text-slate-500 mb-4">Total checks submitted vs approved each month</p>
          <InspectionTrendChart
            data={data.monthly_inspections.map((m) => ({
              month: m.month,
              total: m.total,
              approved: m.approved,
              pending: m.waiting,
            }))}
          />
        </section>

        <section className="lg:col-span-5 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          {data.fault_distribution.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">No problem categories recorded yet.</p>
          ) : (
            <HorizontalBarChart
              title="Fault Category Distribution"
              ariaLabel="Fault category distribution"
              items={data.fault_distribution.map((f) => ({
                label: `${f.category} (${f.open_count} open)`,
                value: f.total,
                color: '#7C3AED',
              }))}
            />
          )}
        </section>
      </div>

      {/* Asset Condition by Category & Open vs Completed Task Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <section className="lg:col-span-7 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <h2 className="text-sm font-bold text-[#1E3A5F] mb-3">Asset Condition by Type</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-[#F4F7FB] text-slate-600 uppercase font-semibold">
                  <th className="px-3 py-2">Asset Type</th>
                  <th className="px-3 py-2">Good</th>
                  <th className="px-3 py-2">Needs Attention</th>
                  <th className="px-3 py-2">Under Repair / Critical</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.condition_trends.map((row) => (
                  <tr key={row.category_name}>
                    <td className="px-3 py-2.5 font-semibold text-slate-900">{row.category_name}</td>
                    <td className="px-3 py-2.5 tabular-nums text-emerald-700 font-semibold">{row.good_count}</td>
                    <td className="px-3 py-2.5 tabular-nums text-amber-700 font-semibold">{row.attention_count}</td>
                    <td className="px-3 py-2.5 tabular-nums text-rose-700 font-semibold">{row.alert_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="lg:col-span-5 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          {data.maintenance_completion.by_status.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">No maintenance tasks created yet.</p>
          ) : (
            <HorizontalBarChart
              title="Tasks by Stage"
              ariaLabel="Maintenance tasks by status"
              items={data.maintenance_completion.by_status.map((s) => ({
                label: s.status,
                value: s.count,
                color: s.status === 'Completed' ? '#10B981' : '#3B82F6',
              }))}
            />
          )}
        </section>
      </div>

      {/* Inspection History Summary */}
      <section className="rounded-2xl border border-slate-200/80 bg-white overflow-hidden shadow-xs">
        <div className="border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-sm font-bold text-[#1E3A5F]">Recent Inspection History</h2>
        </div>
        {data.inspection_history.length === 0 ? (
          <p className="p-5 text-xs text-slate-500">No inspection history stored yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-[#F4F7FB] text-slate-600 uppercase font-semibold">
                  <th className="px-4 py-2.5">Inspection ID</th>
                  <th className="px-4 py-2.5">Asset</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Inspector</th>
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.inspection_history.map((i) => (
                  <tr key={i.inspection_code}>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <code className="font-bold text-[#1E3A5F]">{i.inspection_code}</code>
                        <ProvenanceBadge isDemo={i.is_demo} />
                      </div>
                    </td>
                    <td className="px-4 py-2.5">{i.asset_code} — {i.asset_name}</td>
                    <td className="px-4 py-2.5">{i.inspection_category}</td>
                    <td className="px-4 py-2.5">{i.inspector_name}</td>
                    <td className="px-4 py-2.5 tabular-nums">{i.inspection_date}</td>
                    <td className="px-4 py-2.5"><StatusBadge value={i.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
