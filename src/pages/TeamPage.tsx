import React, { useCallback, useEffect, useState } from 'react';
import { Activity, FolderPlus, HardDrive, RefreshCw, Shield, UserPlus } from 'lucide-react';
import { CardSkeleton, ProvenanceBadge } from '../components/ui/Badges';
import { useToast } from '../context/ToastContext';
import { api, ApiError } from '../lib/api';
import type { AssetCategory, User, UserRole } from '../types';

interface SystemHealth {
  backend_status: string;
  database_status: string;
  db_latency_ms: number;
  api_health: {
    started_at: string;
    total_requests: number;
    error_5xx_count: number;
    error_rate_pct: number;
    p50_ms: number;
    p95_ms: number;
  };
  ai_service_status: string;
  ai_service_detail: string;
  storage: {
    database_bytes: number;
    upload_files_count: number;
    uploads_bytes: number;
    disk_free_bytes: number;
  };
  last_backup: {
    status: string;
    filename?: string;
    size_bytes?: number;
    created_at?: string;
    message?: string;
  };
  latest_test_results: string;
  security_scan_status: string;
}

interface AuditLogRow {
  id: number;
  actor_username: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: string;
  ip_address: string;
  created_at: string;
}

export function TeamPage() {
  const { pushToast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [loading, setLoading] = useState(true);

  const [uUsername, setUUsername] = useState('');
  const [uEmail, setUEmail] = useState('');
  const [uName, setUName] = useState('');
  const [uPass, setUPass] = useState('');
  const [uRole, setURole] = useState<UserRole>('staff');
  const [uDept, setUDept] = useState('Field Maintenance');

  const [cCode, setCCode] = useState('');
  const [cName, setCName] = useState('');
  const [cInterval, setCInterval] = useState('30');
  const [cDesc, setCDesc] = useState('');

  const loadTeam = useCallback(async () => {
    setLoading(true);
    try {
      const t0 = performance.now();
      const [uRes, cRes, lRes, hRes] = await Promise.all([
        api.get<{ items: User[] }>('/api/admin/users'),
        api.get<{ items: AssetCategory[] }>('/api/categories'),
        api.get<{ items: AuditLogRow[] }>('/api/admin/audit-logs?limit=40'),
        api.get<SystemHealth>('/api/admin/system-health'),
      ]);
      setPingMs(Math.round(performance.now() - t0));
      setUsers(uRes.items);
      setCategories(cRes.items);
      setLogs(lRes.items);
      setHealth(hRes);
    } catch (err) {
      pushToast('error', 'Could not load team settings', err instanceof ApiError ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

  const handleBackup = async () => {
    setBackingUp(true);
    try {
      const res = await api.post<{ backup_filename: string; backup_integrity: boolean }>('/api/admin/backup');
      pushToast('success', 'Backup created', `${res.backup_filename} (integrity: ${res.backup_integrity ? 'ok' : 'check'})`);
      await loadTeam();
    } catch (err) {
      pushToast('error', 'Backup failed', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBackingUp(false);
    }
  };

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/api/admin/users', {
        username: uUsername.trim(),
        email: uEmail.trim(),
        full_name: uName.trim(),
        password: uPass,
        role: uRole,
        department: uDept.trim(),
      });
      pushToast('success', 'Team member added', `${uName} added.`);
      setUUsername('');
      setUEmail('');
      setUName('');
      setUPass('');
      await loadTeam();
    } catch (err) {
      pushToast('error', 'Could not add team member', err instanceof ApiError ? err.message : undefined);
    }
  };

  const changeUserRole = async (target: User, newRole: UserRole) => {
    try {
      await api.patch(`/api/admin/users/${target.id}`, { role: newRole });
      pushToast('success', 'Role updated', `${target.full_name} is now ${newRole}.`);
      await loadTeam();
    } catch (err) {
      pushToast('error', 'Role update failed', err instanceof ApiError ? err.message : undefined);
    }
  };

  const toggleUserActive = async (target: User) => {
    try {
      await api.patch(`/api/admin/users/${target.id}`, { is_active: !target.is_active });
      pushToast('success', 'Account updated', `${target.username} status changed.`);
      await loadTeam();
    } catch (err) {
      pushToast('error', 'Update failed', err instanceof ApiError ? err.message : undefined);
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/api/categories', {
        code: cCode.trim().toUpperCase(),
        name: cName.trim(),
        inspection_interval_days: Number(cInterval),
        description: cDesc.trim(),
      });
      pushToast('success', 'Asset type added', cName);
      setCCode('');
      setCName('');
      setCDesc('');
      await loadTeam();
    } catch (err) {
      pushToast('error', 'Could not add asset type', err instanceof ApiError ? err.message : undefined);
    }
  };

  if (loading) return <CardSkeleton rows={6} />;

  return (
    <div className="space-y-6">
      {/* Live System Health Panel */}
      {health && (
        <section aria-label="System Health" className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-[#1E3A5F]" aria-hidden="true" />
              <h2 className="text-sm font-bold text-[#1E3A5F]">System Health &amp; Backups</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void loadTeam()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                Refresh Health
              </button>
              <button
                type="button"
                disabled={backingUp}
                onClick={() => void handleBackup()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#1E3A5F] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#284B78] disabled:opacity-60"
              >
                <HardDrive className="h-3.5 w-3.5" aria-hidden="true" />
                {backingUp ? 'Creating Backup...' : 'Create DB Backup'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="rounded-xl border border-slate-200 bg-[#F4F7FB] p-3">
              <span className="text-slate-600 block">Frontend &amp; Backend</span>
              <strong className="text-emerald-700">{health.backend_status}</strong>
              <span className="block text-[11px] text-slate-600 mt-0.5">Live ping: {pingMs ?? '—'} ms</span>
            </div>
            <div className="rounded-xl border border-slate-200 bg-[#F4F7FB] p-3">
              <span className="text-slate-600 block">Database Integrity</span>
              <strong className={health.database_status === 'HEALTHY' ? 'text-emerald-700' : 'text-rose-700'}>
                {health.database_status}
              </strong>
              <span className="block text-[11px] text-slate-600 mt-0.5">Check time: {health.db_latency_ms} ms</span>
            </div>
            <div className="rounded-xl border border-slate-200 bg-[#F4F7FB] p-3">
              <span className="text-slate-600 block">API Latency &amp; Errors</span>
              <strong className="text-[#1E3A5F] tabular-nums">
                p50 {health.api_health.p50_ms} ms · p95 {health.api_health.p95_ms} ms
              </strong>
              <span className="block text-[11px] text-slate-600 mt-0.5">
                {health.api_health.total_requests} requests · {health.api_health.error_rate_pct}% 5xx errors
              </span>
            </div>
            <div className="rounded-xl border border-slate-200 bg-[#F4F7FB] p-3">
              <span className="text-slate-600 block">Storage &amp; Backups</span>
              <strong className="text-[#1E3A5F] tabular-nums">
                DB {Math.round(health.storage.database_bytes / 1024)} KB · {health.storage.upload_files_count} photos
              </strong>
              <span className="block text-[11px] text-slate-600 mt-0.5 truncate">
                Last backup: {health.last_backup.status === 'AVAILABLE' ? health.last_backup.created_at : 'UNAVAILABLE'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px] text-slate-600">
            <div className="rounded-xl border border-slate-100 px-3 py-2">
              <strong>AI Service:</strong> {health.ai_service_status} — {health.ai_service_detail}
            </div>
            <div className="rounded-xl border border-slate-100 px-3 py-2">
              <strong>Tests:</strong> {health.latest_test_results}
            </div>
            <div className="rounded-xl border border-slate-100 px-3 py-2">
              <strong>Security Scan:</strong> {health.security_scan_status}
            </div>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <section className="lg:col-span-7 rounded-2xl border border-slate-200/80 bg-white p-5 space-y-4 shadow-xs">
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-[#1E3A5F]" aria-hidden="true" />
            <h2 className="text-sm font-bold text-[#1E3A5F]">Team Members &amp; Roles</h2>
          </div>

          <div tabIndex={0} role="region" aria-label="Team members table" className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-[#F4F7FB] font-semibold text-slate-600 uppercase">
                  <th className="px-3 py-2">Member</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Team</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-slate-900">{u.full_name}</span>
                        <ProvenanceBadge isDemo={u.is_demo} />
                      </div>
                      <code className="text-[11px] text-slate-500">{u.username}</code>
                    </td>
                    <td className="px-3 py-2.5">
                      <select
                        aria-label={`Change role for ${u.full_name}`}
                        value={u.role}
                        onChange={(e) => void changeUserRole(u, e.target.value as UserRole)}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
                      >
                        <option value="admin">Admin</option>
                        <option value="inspector">Inspector</option>
                        <option value="engineer">Engineer</option>
                        <option value="staff">Maintenance Staff</option>
                      </select>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{u.department}</td>
                    <td className="px-3 py-2.5">
                      <span className={u.is_active ? 'text-emerald-700 font-semibold' : 'text-rose-700 font-semibold'}>
                        {u.is_active ? 'Active' : 'Off'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button type="button" onClick={() => void toggleUserActive(u)} className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
                        {u.is_active ? 'Turn Off' : 'Turn On'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form onSubmit={(e) => void handleCreateUser(e)} className="border-t border-slate-200 pt-4 space-y-3">
            <h3 className="text-xs font-bold text-slate-800">Add New Team Member</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <input type="text" required value={uUsername} onChange={(e) => setUUsername(e.target.value)} placeholder="Username" aria-label="New username" className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs" />
              <input type="email" required value={uEmail} onChange={(e) => setUEmail(e.target.value)} placeholder="Email" aria-label="New user email" className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs" />
              <input type="text" required value={uName} onChange={(e) => setUName(e.target.value)} placeholder="Full Name" aria-label="New user full name" className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs" />
              <input type="password" required minLength={8} value={uPass} onChange={(e) => setUPass(e.target.value)} placeholder="Password (min 8 chars)" aria-label="New user password" className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs" />
              <select aria-label="New user role" value={uRole} onChange={(e) => setURole(e.target.value as UserRole)} className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs">
                <option value="staff">Maintenance Staff</option>
                <option value="inspector">Inspector</option>
                <option value="engineer">Engineer</option>
                <option value="admin">Admin</option>
              </select>
              <input type="text" required value={uDept} onChange={(e) => setUDept(e.target.value)} placeholder="Team / Department" aria-label="New user department" className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs" />
            </div>
            <button type="submit" className="rounded-xl bg-[#1E3A5F] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#284B78]">
              Add Member
            </button>
          </form>
        </section>

        <section className="lg:col-span-5 rounded-2xl border border-slate-200/80 bg-white p-5 space-y-4 shadow-xs">
          <div className="flex items-center gap-2">
            <FolderPlus className="h-4 w-4 text-[#1E3A5F]" aria-hidden="true" />
            <h2 className="text-sm font-bold text-[#1E3A5F]">Asset Types &amp; Check Schedules</h2>
          </div>

          <div tabIndex={0} role="region" aria-label="Asset types list" className="space-y-2 max-h-56 overflow-y-auto">
            {categories.map((c) => (
              <div key={c.id} className="rounded-xl border border-slate-200 p-2.5 text-xs flex items-center justify-between gap-2">
                <div>
                  <span className="font-bold text-[#1E3A5F]">{c.code}</span> — <span className="font-semibold">{c.name}</span>
                  <p className="text-[11px] text-slate-500">{c.description}</p>
                </div>
                <span className="shrink-0 rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-semibold text-sky-700 tabular-nums">
                  Every {c.inspection_interval_days}d
                </span>
              </div>
            ))}
          </div>

          <form onSubmit={(e) => void handleCreateCategory(e)} className="border-t border-slate-200 pt-4 space-y-2.5">
            <h3 className="text-xs font-bold text-slate-800">Add Asset Type</h3>
            <div className="grid grid-cols-3 gap-2">
              <input type="text" required value={cCode} onChange={(e) => setCCode(e.target.value)} placeholder="Code" aria-label="Category code" className="rounded-xl border border-slate-300 px-2.5 py-1.5 text-xs" />
              <input type="text" required value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Type Name" aria-label="Category name" className="rounded-xl border border-slate-300 px-2.5 py-1.5 text-xs col-span-2" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <input type="number" min={1} max={3650} required value={cInterval} onChange={(e) => setCInterval(e.target.value)} placeholder="Days" aria-label="Check interval in days" className="rounded-xl border border-slate-300 px-2.5 py-1.5 text-xs" />
              <input type="text" value={cDesc} onChange={(e) => setCDesc(e.target.value)} placeholder="Short description" aria-label="Category description" className="rounded-xl border border-slate-300 px-2.5 py-1.5 text-xs col-span-2" />
            </div>
            <button type="submit" className="rounded-xl bg-[#1E3A5F] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#284B78]">
              Add Type
            </button>
          </form>
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200/80 bg-white overflow-hidden shadow-xs">
        <div className="border-b border-slate-200 px-5 py-3.5 flex items-center gap-2">
          <Shield className="h-4 w-4 text-[#1E3A5F]" aria-hidden="true" />
          <h2 className="text-sm font-bold text-[#1E3A5F]">System Activity Log</h2>
        </div>
        <div tabIndex={0} role="region" aria-label="System activity log table" className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-[#F4F7FB] font-semibold text-slate-600 uppercase">
                <th className="px-4 py-2.5">Time (UTC)</th>
                <th className="px-4 py-2.5">Team Member</th>
                <th className="px-4 py-2.5">Action</th>
                <th className="px-4 py-2.5">Item</th>
                <th className="px-4 py-2.5">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className="px-4 py-2.5 whitespace-nowrap tabular-nums text-slate-500">{log.created_at}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap"><span className="font-semibold text-slate-900">{log.actor_username}</span> ({log.actor_role})</td>
                  <td className="px-4 py-2.5 font-semibold text-[#1E3A5F]">{log.action.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-2.5"><code>{log.entity_type}:{log.entity_id}</code></td>
                  <td className="px-4 py-2.5 text-slate-600 max-w-md truncate">{log.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
