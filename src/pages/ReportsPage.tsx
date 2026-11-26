import { useEffect, useState } from 'react';
import { Download, FileText, Printer } from 'lucide-react';
import { CardSkeleton, ProvenanceBadge, StatusBadge } from '../components/ui/Badges';
import { useToast } from '../context/ToastContext';
import { api, ApiError } from '../lib/api';

type ReportTab = 'inspections' | 'asset_condition' | 'maintenance' | 'overdue_tasks' | 'team_activity' | 'fault_summary';

interface ReportPayload {
  generated_at: string;
  asset_condition: {
    asset_code: string;
    asset_name: string;
    category: string;
    section_location: string;
    current_condition: string;
    maintenance_status: string;
    last_inspection_date: string | null;
    next_inspection_date: string | null;
    is_demo: number;
    inspection_count: number;
    open_tasks: number;
  }[];
  inspections: {
    inspection_code: string;
    inspection_date: string;
    inspection_category: string;
    status: string;
    asset_code: string;
    asset_name: string;
    inspector_name: string;
    is_demo: number;
  }[];
  maintenance: {
    work_order_code: string;
    title: string;
    priority: string;
    status: string;
    due_date: string;
    asset_code: string;
    assignee_name: string;
    is_demo: number;
  }[];
  overdue_tasks: {
    work_order_code: string;
    title: string;
    priority: string;
    status: string;
    due_date: string;
    days_overdue: number;
    asset_code: string;
    asset_name: string;
    assignee_name: string;
    is_demo: number;
  }[];
  team_activity: {
    actor_username: string;
    actor_role: string;
    action: string;
    entity_type: string;
    entity_id: string;
    details: string;
    created_at: string;
  }[];
  fault_summary: {
    category: string;
    total_faults: number;
    critical_count: number;
    high_count: number;
    open_count: number;
    verified_count: number;
  }[];
}

const REPORT_TABS: { id: ReportTab; label: string }[] = [
  { id: 'inspections', label: 'Inspection Reports' },
  { id: 'asset_condition', label: 'Asset Condition Reports' },
  { id: 'maintenance', label: 'Maintenance Reports' },
  { id: 'overdue_tasks', label: 'Overdue Task Reports' },
  { id: 'team_activity', label: 'Team Activity Reports' },
  { id: 'fault_summary', label: 'Fault Summary Reports' },
];

export function ReportsPage() {
  const { pushToast } = useToast();
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [activeTab, setActiveTab] = useState<ReportTab>('asset_condition');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .get<ReportPayload>('/api/reports')
      .then((res) => {
        if (active) setReport(res);
      })
      .catch((err) => {
        pushToast('error', 'Could not load reports', err instanceof ApiError ? err.message : undefined);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [pushToast]);

  const downloadFile = async (fmt: 'pdf' | 'csv') => {
    setExporting(true);
    try {
      const blob = await api.downloadBlob(`/api/reports/export?fmt=${fmt}&report_type=${activeTab}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `railpulse-${activeTab}-report.${fmt}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      pushToast('success', 'Report downloaded', `Saved ${activeTab} (${fmt.toUpperCase()}).`);
    } catch (err) {
      pushToast('error', 'Download failed', err instanceof ApiError ? err.message : undefined);
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <CardSkeleton rows={6} />;
  if (!report) return null;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-3 no-print">
        <div>
          <h2 className="text-sm font-bold text-[#1E3A5F]">Download &amp; Review Reports</h2>
          <p className="text-xs text-slate-500 tabular-nums">Built directly from your saved database records ({report.generated_at})</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={exporting}
            onClick={() => void downloadFile('pdf')}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#1E3A5F] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#284B78]"
          >
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            Download PDF
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={() => void downloadFile('csv')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Download CSV
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Printer className="h-3.5 w-3.5" aria-hidden="true" />
            Print
          </button>
        </div>
      </div>

      {/* 5 Report Tabs */}
      <div className="flex flex-wrap gap-2 no-print" role="tablist" aria-label="Report types">
        {REPORT_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            onClick={() => setActiveTab(t.id)}
            className={`rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors ${
              activeTab === t.id ? 'bg-[#1E3A5F] text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <section className="rounded-2xl border border-slate-200/80 bg-white overflow-hidden shadow-xs">
        {activeTab === 'asset_condition' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-[#F4F7FB] font-semibold text-slate-600 uppercase">
                  <th className="px-4 py-3">Asset ID</th>
                  <th className="px-4 py-3">Name &amp; Location</th>
                  <th className="px-4 py-3">Condition</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Last Check</th>
                  <th className="px-4 py-3">Next Check</th>
                  <th className="px-4 py-3">Open Tasks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.asset_condition.map((a) => (
                  <tr key={a.asset_code}>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <code className="font-bold text-[#1E3A5F]">{a.asset_code}</code>
                        <ProvenanceBadge isDemo={a.is_demo} />
                      </div>
                    </td>
                    <td className="px-4 py-3"><strong className="text-slate-900">{a.asset_name}</strong><span className="block text-[11px] text-slate-500">{a.section_location}</span></td>
                    <td className="px-4 py-3"><StatusBadge value={a.current_condition} /></td>
                    <td className="px-4 py-3"><StatusBadge value={a.maintenance_status} /></td>
                    <td className="px-4 py-3 tabular-nums">{a.last_inspection_date || 'None'}</td>
                    <td className="px-4 py-3 tabular-nums">{a.next_inspection_date || 'Not set'}</td>
                    <td className="px-4 py-3 tabular-nums font-semibold">{a.open_tasks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'inspections' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-[#F4F7FB] font-semibold text-slate-600 uppercase">
                  <th className="px-4 py-3">Inspection ID</th>
                  <th className="px-4 py-3">Asset</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Inspector</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.inspections.map((i) => (
                  <tr key={i.inspection_code}>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <code className="font-bold text-[#1E3A5F]">{i.inspection_code}</code>
                        <ProvenanceBadge isDemo={i.is_demo} />
                      </div>
                    </td>
                    <td className="px-4 py-3">{i.asset_code} — {i.asset_name}</td>
                    <td className="px-4 py-3">{i.inspection_category}</td>
                    <td className="px-4 py-3">{i.inspector_name}</td>
                    <td className="px-4 py-3 tabular-nums">{i.inspection_date}</td>
                    <td className="px-4 py-3"><StatusBadge value={i.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'maintenance' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-[#F4F7FB] font-semibold text-slate-600 uppercase">
                  <th className="px-4 py-3">Task ID</th>
                  <th className="px-4 py-3">Task &amp; Asset</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Assigned To</th>
                  <th className="px-4 py-3">Due Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.maintenance.map((m) => (
                  <tr key={m.work_order_code}>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <code className="font-bold text-[#1E3A5F]">{m.work_order_code}</code>
                        <ProvenanceBadge isDemo={m.is_demo} />
                      </div>
                    </td>
                    <td className="px-4 py-3"><strong className="text-slate-900">{m.title}</strong><span className="block text-[11px] text-slate-500">{m.asset_code}</span></td>
                    <td className="px-4 py-3"><StatusBadge value={m.priority} /></td>
                    <td className="px-4 py-3"><StatusBadge value={m.status} /></td>
                    <td className="px-4 py-3">{m.assignee_name}</td>
                    <td className="px-4 py-3 tabular-nums">{m.due_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'overdue_tasks' && (
          <div className="overflow-x-auto">
            {report.overdue_tasks.length === 0 ? (
              <p className="p-6 text-xs text-slate-600">No overdue maintenance tasks found in saved database records.</p>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-[#F4F7FB] font-semibold text-slate-600 uppercase">
                    <th className="px-4 py-3">Task ID</th>
                    <th className="px-4 py-3">Task &amp; Asset</th>
                    <th className="px-4 py-3">Priority</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Assigned To</th>
                    <th className="px-4 py-3">Due Date</th>
                    <th className="px-4 py-3">Days Overdue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.overdue_tasks.map((m) => (
                    <tr key={m.work_order_code}>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <code className="font-bold text-[#1E3A5F]">{m.work_order_code}</code>
                          <ProvenanceBadge isDemo={m.is_demo} />
                        </div>
                      </td>
                      <td className="px-4 py-3"><strong className="text-slate-900">{m.title}</strong><span className="block text-[11px] text-slate-500">{m.asset_code} — {m.asset_name}</span></td>
                      <td className="px-4 py-3"><StatusBadge value={m.priority} /></td>
                      <td className="px-4 py-3"><StatusBadge value={m.status} /></td>
                      <td className="px-4 py-3">{m.assignee_name}</td>
                      <td className="px-4 py-3 tabular-nums">{m.due_date}</td>
                      <td className="px-4 py-3 tabular-nums font-bold text-rose-700">{m.days_overdue}d</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'team_activity' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-[#F4F7FB] font-semibold text-slate-600 uppercase">
                  <th className="px-4 py-3">Time (UTC)</th>
                  <th className="px-4 py-3">Team Member</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.team_activity.map((a, idx) => (
                  <tr key={idx}>
                    <td className="px-4 py-3 tabular-nums text-slate-500">{a.created_at}</td>
                    <td className="px-4 py-3"><strong>{a.actor_username}</strong> ({a.actor_role})</td>
                    <td className="px-4 py-3 font-semibold text-[#1E3A5F]">{a.action.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3"><code>{a.entity_type}:{a.entity_id}</code></td>
                    <td className="px-4 py-3 text-slate-600">{a.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'fault_summary' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-[#F4F7FB] font-semibold text-slate-600 uppercase">
                  <th className="px-4 py-3">Problem Category</th>
                  <th className="px-4 py-3">Total Reported</th>
                  <th className="px-4 py-3">Critical</th>
                  <th className="px-4 py-3">High</th>
                  <th className="px-4 py-3">Open</th>
                  <th className="px-4 py-3">Human Verified</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.fault_summary.map((f) => (
                  <tr key={f.category}>
                    <td className="px-4 py-3 font-semibold text-slate-900">{f.category}</td>
                    <td className="px-4 py-3 tabular-nums font-semibold">{f.total_faults}</td>
                    <td className="px-4 py-3 tabular-nums text-rose-700 font-semibold">{f.critical_count}</td>
                    <td className="px-4 py-3 tabular-nums text-amber-700 font-semibold">{f.high_count}</td>
                    <td className="px-4 py-3 tabular-nums">{f.open_count}</td>
                    <td className="px-4 py-3 tabular-nums text-emerald-700 font-semibold">{f.verified_count}</td>
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
