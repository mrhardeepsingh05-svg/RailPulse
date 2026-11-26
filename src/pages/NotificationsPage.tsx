import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { CardSkeleton, EmptyState } from '../components/ui/Badges';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import type { NotificationItem } from '../types';

const SEVERITY_BADGES: Record<string, string> = {
  critical: 'bg-rose-50 text-rose-700 border-rose-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  info: 'bg-sky-50 text-sky-700 border-sky-200',
};

export function NotificationsPage() {
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ items: NotificationItem[] }>('/api/notifications');
      setItems(res.items);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const markRead = async (item: NotificationItem) => {
    await api.patch(`/api/notifications/${item.id}/read`).catch(() => {});
    setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, is_read: 1 } : n)));
    navigate(item.link_path || '/');
  };

  const markAllRead = async () => {
    await api.post('/api/notifications/read-all').catch(() => {});
    setItems((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
    pushToast('success', 'All caught up', 'All notifications marked as read.');
  };

  if (loading) return <CardSkeleton rows={5} />;

  const visible = filter === 'unread' ? items.filter((i) => !i.is_read) : items;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold ${filter === 'all' ? 'bg-[#1E3A5F] text-white' : 'bg-[#F4F7FB] text-slate-700'}`}
          >
            All ({items.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('unread')}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold ${filter === 'unread' ? 'bg-[#1E3A5F] text-white' : 'bg-[#F4F7FB] text-slate-700'}`}
          >
            Unread ({items.filter((i) => !i.is_read).length})
          </button>
        </div>

        <button
          type="button"
          onClick={() => void markAllRead()}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Mark All Read
        </button>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-5 w-5" aria-hidden="true" />}
          title="No notifications to show"
          description="Alerts for new inspections, assigned tasks, completed repairs, and reminders appear here."
        />
      ) : (
        <div className="space-y-2.5">
          {visible.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => void markRead(n)}
              className={`w-full text-left rounded-2xl border p-4 shadow-xs transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                n.is_read ? 'border-slate-200/80 bg-white opacity-80' : 'border-sky-200 bg-sky-50/40'
              }`}
            >
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${SEVERITY_BADGES[n.severity] || SEVERITY_BADGES.info}`}>
                    {n.category.replace(/_/g, ' ')}
                  </span>
                  <span className="text-sm font-semibold text-slate-900">{n.title}</span>
                  {!n.is_read && <span className="h-2 w-2 rounded-full bg-sky-600" aria-label="Unread" />}
                </div>
                <p className="text-xs text-slate-600 mt-1">{n.message}</p>
              </div>
              <span className="text-[11px] text-slate-400 tabular-nums shrink-0">{n.created_at}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
