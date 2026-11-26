import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Database,
  FileText,
  Plus,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import { CardSkeleton, ProvenanceBadge, StatusBadge } from '../components/ui/Badges';
import { HorizontalBarChart } from '../components/ui/Charts';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import type { AssetCategory, DashboardSummary } from '../types';

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [daysFilter, setDaysFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ items: AssetCategory[] }>('/api/categories')
      .then((res) => setCategories(res.items))
      .catch(() => {});
  }, []);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (categoryId) params.set('category_id', categoryId);
      if (daysFilter) params.set('days', daysFilter);
      const qs = params.toString();
      const res = await api.get<DashboardSummary>(`/api/dashboard${qs ? `?${qs}` : ''}`);
      setData(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load dashboard data.');
    } finally {
      setLoading(false);
    }
  }, [categoryId, daysFilter]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  if (loading && !data) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <CardSkeleton rows={3} />
        <CardSkeleton rows={3} />
        <CardSkeleton rows={3} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
        {error || 'Dashboard information is not available right now.'}
      </div>
    );
  }

  const { kpis } = data;

  const kpiCards = [
    {
      label: 'Total Railway Assets',
      value: kpis.total_assets,
      sub: `${kpis.demo_assets} demo · ${kpis.real_assets} live`,
      icon: Database,
      accent: 'text-sky-700 bg-sky-50',
    },
    {
      label: 'Inspections Completed',
      value: kpis.inspections_completed,
      sub: `${kpis.inspections_followup} need follow-up`,
      icon: CheckCircle2,
      accent: 'text-emerald-700 bg-emerald-50',
    },
    {
      label: 'Inspections Waiting',
      value: kpis.inspections_waiting,
      sub: 'Waiting for review',
      icon: Clock,
      accent: 'text-amber-700 bg-amber-50',
    },
    {
      label: 'Open Maintenance Tasks',
      value: kpis.open_maintenance_tasks,
      sub: `${kpis.overdue_maintenance_tasks} past due date`,
      icon: Wrench,
      accent: 'text-violet-700 bg-violet-50',
    },
    {
      label: 'Critical Alerts',
      value: kpis.critical_alerts,
      sub: 'Assets needing immediate look',
      icon: ShieldAlert,
      accent: 'text-rose-700 bg-rose-50',
    },
    {
      label: 'Assets Requiring Attention',
      value: kpis.assets_requiring_attention,
      sub: 'Needs attention or under repair',
      icon: AlertTriangle,
      accent: 'text-amber-700 bg-amber-50',
    },
  ];

  const conditionColors: Record<string, string> = {
    Good: '#10B981',
    'Needs Attention': '#F59E0B',
    'Under Repair': '#3B82F6',
    'Critical Alert': '#EF4444',
  };

  return (
    <div className="space-y-6">
      {/* Filter & Quick Action Bar */}
      <div className="rounded-2xl border border-slate-200/80 bg-white px-5 py-4 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-bold text-violet-700">
            {data.data_provenance.label}
          </span>
          <select
            aria-label="Filter dashboard by asset type"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="rounded-xl border border-slate-200 bg-[#F4F7FB] px-3 py-1.5 text-xs font-medium text-slate-800"
          >
            <option value="">All Asset Types</option>
            {categories.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter inspections by time range"
            value={daysFilter}
            onChange={(e) => setDaysFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-[#F4F7FB] px-3 py-1.5 text-xs font-medium text-slate-800"
          >
            <option value="">All Dates</option>
            <option value="30">Last 30 Days</option>
            <option value="90">Last 90 Days</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {user?.role !== 'staff' && (
            <button
              type="button"
              onClick={() => navigate('/inspections')}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#1E3A5F] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#284B78]"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              New Inspection
            </button>
          )}
          <button
            type="button"
            onClick={() => navigate('/assets')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            View Assets
          </button>
          {user?.role !== 'staff' && (
            <button
              type="button"
              onClick={() => navigate('/reports')}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
              Reports
            </button>
          )}
        </div>
      </div>

      {/* KPI Grid */}
      <section aria-label="Key Numbers" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-slate-500">{card.label}</p>
                <p className="mt-1.5 text-2xl font-bold text-[#1E3A5F] tabular-nums">{card.value}</p>
                <p className="mt-1 text-[11px] text-slate-500">{card.sub}</p>
              </div>
              <div className={`flex h-11 w-11 items-center justify-center rounded-2xl shrink-0 ${card.accent}`}>
                <Icon className="h-5 w-5" aria-hidden="true" />
              </div>
            </div>
          );
        })}
      </section>

      {/* Maintenance Progress + Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <section className="lg:col-span-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-[#1E3A5F]">Maintenance Progress</h2>
          <div className="rounded-xl bg-[#F4F7FB] p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-600">Tasks Completed</span>
              <span className="font-bold text-[#1E3A5F] tabular-nums">{data.maintenance_progress.completion_pct}%</span>
            </div>
            <div
              className="h-3 w-full rounded-full bg-slate-200 overflow-hidden"
              role="progressbar"
              aria-valuenow={data.maintenance_progress.completion_pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Maintenance completion progress"
            >
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${data.maintenance_progress.completion_pct}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-slate-500 pt-1">
              <span>{data.maintenance_progress.completed} completed</span>
              <span>{data.maintenance_progress.open} open</span>
            </div>
          </div>

          <HorizontalBarChart
            title="Asset Condition Overview"
            ariaLabel="Asset condition overview"
            items={data.asset_condition_overview.map((c) => ({
              label: c.condition,
              value: c.count,
              color: conditionColors[c.condition] || '#64748B',
            }))}
          />
        </section>

        <section className="lg:col-span-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <h2 className="text-sm font-bold text-[#1E3A5F] mb-3">Fault Category Chart</h2>
          {data.fault_category_chart.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">No fault reports recorded for this filter yet.</p>
          ) : (
            <HorizontalBarChart
              title="Reported Problems by Type"
              ariaLabel="Fault category chart"
              items={data.fault_category_chart.map((f) => ({
                label: f.category,
                value: f.count,
                color: '#7C3AED',
              }))}
            />
          )}
        </section>

        <section className="lg:col-span-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-[#1E3A5F] flex items-center gap-1.5">
              <CalendarClock className="h-4 w-4 text-sky-600" aria-hidden="true" />
              Upcoming Inspections
            </h2>
            <button
              type="button"
              onClick={() => navigate('/calendar')}
              className="text-[11px] font-semibold text-sky-600 hover:underline"
            >
              Calendar
            </button>
          </div>
          {data.upcoming_inspections.length === 0 ? (
            <p className="text-xs text-slate-500 py-6 text-center">No inspections due in the next 14 days.</p>
          ) : (
            <div className="space-y-2.5">
              {data.upcoming_inspections.map((u) => (
                <div key={u.id} className="rounded-xl border border-slate-200/80 bg-[#F4F7FB] p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">{u.asset_code} — {u.name}</span>
                    <StatusBadge value={u.current_condition} />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Due: <strong className="text-slate-700 tabular-nums">{u.next_inspection_date}</strong> · {u.category_name}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Recent Activities */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-[#1E3A5F]">Recent Activities</h2>
          <ProvenanceBadge isDemo={data.data_provenance.has_demo_records} />
        </div>
        {data.recent_activities.length === 0 ? (
          <p className="text-xs text-slate-500">No recent activity recorded yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {data.recent_activities.map((act) => (
              <div key={act.id} className="py-2.5 flex items-start justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-900">{act.action.replace(/_/g, ' ')}</span>
                    <code className="text-[11px] text-sky-700 font-mono">{act.entity_id}</code>
                  </div>
                  <p className="text-slate-600 mt-0.5 truncate">{act.details || 'Record updated'}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-medium text-slate-700">{act.actor_username}</p>
                  <p className="text-[10px] text-slate-400 tabular-nums">{act.created_at.slice(0, 16).replace('T', ' ')}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
