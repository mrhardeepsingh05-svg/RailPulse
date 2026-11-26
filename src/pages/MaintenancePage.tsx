import React, { useCallback, useEffect, useState } from 'react';
import { History, Plus, Upload, Wrench, X } from 'lucide-react';
import { CardSkeleton, EmptyState, ProvenanceBadge, StatusBadge } from '../components/ui/Badges';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api, ApiError } from '../lib/api';
import type {
  FaultReport,
  MaintenanceRecord,
  RailwayAsset,
  StoredImage,
  WorkOrder,
  WorkOrderPriority,
  WorkOrderStatus,
} from '../types';

interface TeamOption {
  id: number;
  full_name: string;
  role: string;
}

const TASK_STATUSES: WorkOrderStatus[] = ['New', 'Assigned', 'In Progress', 'Waiting for Review', 'Completed'];
const TASK_PRIORITIES: WorkOrderPriority[] = ['Low', 'Medium', 'High', 'Critical'];

function AuthTaskImage({ storedFilename, alt }: { storedFilename: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    api
      .downloadBlob(`/api/files/${storedFilename}`)
      .then((blob) => {
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => {});
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [storedFilename]);
  if (!src) return <div className="h-16 w-24 rounded-xl border border-slate-200 bg-slate-100 animate-pulse" />;
  return <img src={src} alt={alt} className="h-16 w-24 rounded-xl border border-slate-200 object-cover" />;
}

export function MaintenancePage() {
  const { user } = useAuth();
  const { pushToast } = useToast();

  const [tasks, setTasks] = useState<WorkOrder[]>([]);
  const [assets, setAssets] = useState<RailwayAsset[]>([]);
  const [faults, setFaults] = useState<FaultReport[]>([]);
  const [assignableTeam, setAssignableTeam] = useState<TeamOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState('');
  const [assignedToMe, setAssignedToMe] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [cAssetId, setCAssetId] = useState('');
  const [cFaultId, setCFaultId] = useState('');
  const [cTitle, setCTitle] = useState('');
  const [cDesc, setCDesc] = useState('');
  const [cPriority, setCPriority] = useState<WorkOrderPriority>('High');
  const [cAssignee, setCAssignee] = useState('');
  const [cDueDate, setCDueDate] = useState(() => new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10));
  const [todayStr] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  const [selectedTask, setSelectedTask] = useState<{
    work_order: WorkOrder;
    history: MaintenanceRecord[];
    images: StoredImage[];
  } | null>(null);
  const [uStatus, setUStatus] = useState<WorkOrderStatus>('In Progress');
  const [uAssignee, setUAssignee] = useState('');
  const [uNotes, setUNotes] = useState('');
  const [uCompletionNotes, setUCompletionNotes] = useState('');

  const isEngineerOrAdmin = user?.role === 'engineer' || user?.role === 'admin';

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (assignedToMe) params.set('assigned_to_me', 'true');
      const res = await api.get<{ items: WorkOrder[] }>(`/api/work-orders?${params.toString()}`);
      setTasks(res.items);
    } catch (err) {
      pushToast('error', 'Could not load maintenance tasks', err instanceof ApiError ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, assignedToMe, pushToast]);

  useEffect(() => {
    Promise.all([
      api.get<{ items: RailwayAsset[] }>('/api/assets?page_size=100'),
      api.get<{ items: FaultReport[] }>('/api/faults'),
      api.get<{ items: TeamOption[] }>('/api/team/members'),
    ])
      .then(([aRes, fRes, tRes]) => {
        setAssets(aRes.items);
        if (aRes.items[0]) setCAssetId(String(aRes.items[0].id));
        setFaults(fRes.items.filter((f) => f.status !== 'Resolved'));
        setAssignableTeam(tRes.items.filter((m) => m.role === 'engineer' || m.role === 'staff'));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const openDetail = async (id: number) => {
    try {
      const detail = await api.get<{ work_order: WorkOrder; history: MaintenanceRecord[]; images: StoredImage[] }>(`/api/work-orders/${id}`);
      setSelectedTask(detail);
      setUStatus(detail.work_order.status);
      setUAssignee(detail.work_order.assigned_to ? String(detail.work_order.assigned_to) : '');
      setUNotes(detail.work_order.maintenance_notes || '');
      setUCompletionNotes(detail.work_order.completion_notes || '');
    } catch (err) {
      pushToast('error', 'Could not open task details', err instanceof ApiError ? err.message : undefined);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cTitle.trim().length < 3 || cDesc.trim().length < 5) {
      pushToast('warning', 'Check your inputs', 'Please enter a task title and description.');
      return;
    }
    setSaving(true);
    try {
      const created = await api.post<WorkOrder>('/api/work-orders', {
        asset_id: Number(cAssetId),
        fault_report_id: cFaultId ? Number(cFaultId) : null,
        title: cTitle.trim(),
        description: cDesc.trim(),
        priority: cPriority,
        assigned_to: cAssignee ? Number(cAssignee) : null,
        due_date: cDueDate,
      });
      pushToast('success', 'Task created', `${created.work_order_code} (${created.status})`);
      setShowCreate(false);
      setCTitle('');
      setCDesc('');
      setCFaultId('');
      await loadTasks();
    } catch (err) {
      pushToast('error', 'Could not create task', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTask) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        status: uStatus,
        maintenance_notes: uNotes,
        completion_notes: uCompletionNotes,
      };
      if (isEngineerOrAdmin && uAssignee) {
        payload.assigned_to = Number(uAssignee);
      }
      await api.patch(`/api/work-orders/${selectedTask.work_order.id}`, payload);
      pushToast('success', 'Task updated', `${selectedTask.work_order.work_order_code} -> ${uStatus}`);
      await openDetail(selectedTask.work_order.id);
      await loadTasks();
    } catch (err) {
      pushToast('error', 'Update not allowed', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const handleUploadSupportingImage = async (woId: number, selected: FileList | null) => {
    if (!selected || selected.length === 0) return;
    const fd = new FormData();
    Array.from(selected).forEach((f) => fd.append('files', f));
    try {
      await api.post(`/api/work-orders/${woId}/images`, fd);
      pushToast('success', 'Photo uploaded', 'Supporting photo added to task.');
      await openDetail(woId);
      await loadTasks();
    } catch (err) {
      pushToast('error', 'Upload failed', err instanceof ApiError ? err.message : undefined);
    }
  };

  const canUpdateSelected =
    selectedTask &&
    (isEngineerOrAdmin || (user?.role === 'staff' && selectedTask.work_order.assigned_to === user.id));

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Filter maintenance tasks by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-[#F4F7FB] px-3 py-2 text-xs font-medium text-slate-800"
          >
            <option value="">All Statuses</option>
            {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
            <input type="checkbox" checked={assignedToMe} onChange={(e) => setAssignedToMe(e.target.checked)} className="h-4 w-4 rounded" />
            Only tasks assigned to me
          </label>
        </div>

        {isEngineerOrAdmin && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-[#1E3A5F] px-4 py-2 text-xs font-semibold text-white hover:bg-[#284B78]"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Create Task
          </button>
        )}
      </div>

      {loading ? (
        <CardSkeleton rows={5} />
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={<Wrench className="h-5 w-5" aria-hidden="true" />}
          title="No maintenance tasks found"
          description="Adjust your filters or create a new maintenance task for an asset."
        />
      ) : (
        <div className="rounded-2xl border border-slate-200/80 bg-white overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-[#F4F7FB] text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                  <th className="px-4 py-3">Task ID</th>
                  <th className="px-4 py-3">Task &amp; Asset</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Assigned To</th>
                  <th className="px-4 py-3">Due Date</th>
                  <th className="px-4 py-3 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {tasks.map((t) => {
                  const isOverdue = t.status !== 'Completed' && t.due_date < todayStr;
                  return (
                    <tr key={t.id} className="hover:bg-sky-50/30">
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <div className="flex flex-col items-start gap-1">
                          <code className="font-bold text-[#1E3A5F]">{t.work_order_code}</code>
                          <ProvenanceBadge isDemo={t.is_demo} />
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="font-semibold text-slate-900 text-sm">{t.title}</p>
                        <p className="text-slate-600">{t.asset_code} — {t.asset_name}</p>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap"><StatusBadge value={t.priority} /></td>
                      <td className="px-4 py-3.5 whitespace-nowrap"><StatusBadge value={t.status} /></td>
                      <td className="px-4 py-3.5 text-slate-700">{t.assignee_name || <span className="text-slate-600">Unassigned</span>}</td>
                      <td className="px-4 py-3.5 tabular-nums whitespace-nowrap">
                        <span className={isOverdue ? 'font-bold text-rose-600' : 'text-slate-700'}>{t.due_date}</span>
                        {isOverdue && <span className="block text-[10px] font-bold text-rose-600">PAST DUE</span>}
                      </td>
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => void openDetail(t.id)}
                          className="inline-flex items-center gap-1 rounded-xl border border-sky-200 bg-sky-50 px-3 py-1.5 font-semibold text-sky-700 hover:bg-sky-100"
                        >
                          <History className="h-3.5 w-3.5" aria-hidden="true" />
                          Open &amp; History
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create Task Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-label="Create Maintenance Task">
          <div className="w-full max-w-lg rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between bg-[#1E3A5F] px-5 py-4 text-white">
              <h2 className="text-sm font-bold">New Maintenance Task</h2>
              <button type="button" onClick={() => setShowCreate(false)} aria-label="Close" className="rounded p-1 hover:bg-white/10">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <form onSubmit={(e) => void handleCreate(e)} className="p-5 space-y-4 max-h-[82vh] overflow-y-auto text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="wo-asset" className="block font-semibold text-slate-700">Railway Asset</label>
                  <select id="wo-asset" value={cAssetId} onChange={(e) => setCAssetId(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
                    {assets.map((a) => <option key={a.id} value={String(a.id)}>{a.asset_code} — {a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="wo-fault" className="block font-semibold text-slate-700">Related Problem (optional)</label>
                  <select id="wo-fault" value={cFaultId} onChange={(e) => setCFaultId(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
                    <option value="">None</option>
                    {faults.map((f) => <option key={f.id} value={String(f.id)}>{f.fault_code} — {f.title}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="wo-title" className="block font-semibold text-slate-700">Task Title</label>
                <input id="wo-title" type="text" required value={cTitle} onChange={(e) => setCTitle(e.target.value)} placeholder="e.g. Fix loose clips on Switch #14A" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="wo-prio" className="block font-semibold text-slate-700">Priority</label>
                  <select id="wo-prio" value={cPriority} onChange={(e) => setCPriority(e.target.value as WorkOrderPriority)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
                    {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="wo-eng" className="block font-semibold text-slate-700">Assign To</label>
                  <select id="wo-eng" value={cAssignee} onChange={(e) => setCAssignee(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
                    <option value="">Keep as New</option>
                    {assignableTeam.map((m) => <option key={m.id} value={String(m.id)}>{m.full_name}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="wo-due" className="block font-semibold text-slate-700">Due Date</label>
                  <input id="wo-due" type="date" required value={cDueDate} onChange={(e) => setCDueDate(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label htmlFor="wo-desc" className="block font-semibold text-slate-700">Work Description</label>
                <textarea id="wo-desc" rows={3} required value={cDesc} onChange={(e) => setCDesc(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowCreate(false)} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700">Cancel</button>
                <button type="submit" disabled={saving} className="rounded-xl bg-[#1E3A5F] px-4 py-2 font-semibold text-white hover:bg-[#284B78] disabled:opacity-60">
                  {saving ? 'Saving...' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail & Progress Modal */}
      {selectedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-label="Maintenance Task Details">
          <div className="w-full max-w-2xl rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
            <div className="flex items-center justify-between bg-[#1E3A5F] px-5 py-4 text-white">
              <div>
                <code className="text-xs font-bold text-sky-200">{selectedTask.work_order.work_order_code}</code>
                <h2 className="text-sm font-bold">{selectedTask.work_order.title}</h2>
              </div>
              <button type="button" onClick={() => setSelectedTask(null)} aria-label="Close" className="rounded p-1 hover:bg-white/10">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-5 text-xs">
              <div className="rounded-xl border border-slate-200 bg-[#F4F7FB] p-3.5 space-y-1.5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="font-semibold text-slate-900">{selectedTask.work_order.asset_code} — {selectedTask.work_order.asset_name}</span>
                  <div className="flex items-center gap-1.5">
                    <StatusBadge value={selectedTask.work_order.priority} />
                    <StatusBadge value={selectedTask.work_order.status} />
                  </div>
                </div>
                <p className="text-slate-700">{selectedTask.work_order.description}</p>
                <p className="text-slate-500">
                  Due: <strong className="text-slate-800">{selectedTask.work_order.due_date}</strong> · Assigned to:{' '}
                  <strong className="text-slate-800">{selectedTask.work_order.assignee_name || 'Unassigned'}</strong>
                </p>
              </div>

              {/* Supporting Images */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold uppercase tracking-wider text-slate-600">Supporting Photos ({selectedTask.images.length})</h3>
                  {canUpdateSelected && (
                    <label className="inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-3 py-1.5 font-semibold text-sky-700 cursor-pointer hover:bg-sky-100">
                      <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                      Upload Photo
                      <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => void handleUploadSupportingImage(selectedTask.work_order.id, e.target.files)} className="sr-only" />
                    </label>
                  )}
                </div>
                {selectedTask.images.length === 0 ? (
                  <p className="text-slate-500">No repair photos uploaded yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-2.5">
                    {selectedTask.images.map((img) => (
                      <div key={img.id} className="space-y-1">
                        <AuthTaskImage storedFilename={img.stored_filename} alt={img.original_filename} />
                        <p className="text-[10px] text-slate-500 truncate max-w-24">{img.original_filename}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {canUpdateSelected && (
                <form onSubmit={(e) => void handleUpdate(e)} className="rounded-xl border border-slate-200 p-4 space-y-3">
                  <h3 className="font-bold uppercase tracking-wider text-slate-700">Update Task Progress</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="u-status" className="block font-semibold text-slate-700">Status</label>
                      <select id="u-status" value={uStatus} onChange={(e) => setUStatus(e.target.value as WorkOrderStatus)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2">
                        {(isEngineerOrAdmin ? TASK_STATUSES : (['In Progress', 'Waiting for Review'] as WorkOrderStatus[])).map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                    {isEngineerOrAdmin && (
                      <div>
                        <label htmlFor="u-assignee" className="block font-semibold text-slate-700">Assigned To</label>
                        <select id="u-assignee" value={uAssignee} onChange={(e) => setUAssignee(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2">
                          <option value="">Unassigned</option>
                          {assignableTeam.map((m) => <option key={m.id} value={String(m.id)}>{m.full_name}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                  <div>
                    <label htmlFor="u-notes" className="block font-semibold text-slate-700">Work Notes</label>
                    <textarea id="u-notes" rows={2} value={uNotes} onChange={(e) => setUNotes(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" />
                  </div>
                  <div>
                    <label htmlFor="u-cnotes" className="block font-semibold text-slate-700">Completion Notes</label>
                    <textarea id="u-cnotes" rows={2} value={uCompletionNotes} onChange={(e) => setUCompletionNotes(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" />
                  </div>
                  <div className="flex justify-end">
                    <button type="submit" disabled={saving} className="rounded-xl bg-[#1E3A5F] px-4 py-2 font-semibold text-white hover:bg-[#284B78] disabled:opacity-60">
                      {saving ? 'Saving...' : 'Save Update'}
                    </button>
                  </div>
                </form>
              )}

              <div>
                <h3 className="font-bold uppercase tracking-wider text-slate-700 mb-2">Task History ({selectedTask.history.length})</h3>
                <div className="space-y-2">
                  {selectedTask.history.map((h) => (
                    <div key={h.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900">
                          {h.previous_status ? `${h.previous_status} → ${h.new_status}` : `Created (${h.new_status})`}
                        </span>
                        <span className="text-[11px] text-slate-600 tabular-nums">{h.recorded_at}</span>
                      </div>
                      <p className="text-slate-700 mt-0.5">{h.action_summary}</p>
                      {h.notes && <p className="text-slate-600 mt-0.5 italic">&ldquo;{h.notes}&rdquo;</p>}
                      <p className="text-[11px] text-slate-500 mt-1">By {h.performed_by_name}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
