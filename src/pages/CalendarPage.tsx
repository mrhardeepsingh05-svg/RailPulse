import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { CardSkeleton, StatusBadge } from '../components/ui/Badges';
import { api } from '../lib/api';
import type { CalendarEvent } from '../types';

const EVENT_COLORS: Record<string, string> = {
  upcoming_inspection: 'bg-sky-50 text-sky-800 border-sky-200',
  maintenance_deadline: 'bg-amber-50 text-amber-800 border-amber-200',
  completed_activity: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  maintenance_schedule: 'bg-violet-50 text-violet-800 border-violet-200',
};

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function CalendarPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month');
  const [cursor, setCursor] = useState(() => new Date());
  const [typeFilter, setTypeFilter] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

  useEffect(() => {
    api
      .get<{ events: CalendarEvent[] }>('/api/calendar')
      .then((res) => setEvents(res.events))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <CardSkeleton rows={6} />;

  const filteredEvents = typeFilter ? events.filter((e) => e.type === typeFilter) : events;

  // Build visible day cells
  const days: Date[] = [];
  if (viewMode === 'month') {
    const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startOffset = firstOfMonth.getDay();
    const start = new Date(firstOfMonth);
    start.setDate(firstOfMonth.getDate() - startOffset);
    for (let i = 0; i < 35; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
  } else {
    const startOfWeek = new Date(cursor);
    startOfWeek.setDate(cursor.getDate() - cursor.getDay());
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);
      days.push(d);
    }
  }

  const movePeriod = (dir: -1 | 1) => {
    const next = new Date(cursor);
    if (viewMode === 'month') next.setMonth(cursor.getMonth() + dir);
    else next.setDate(cursor.getDate() + dir * 7);
    setCursor(next);
  };

  const todayIso = toIsoDate(new Date());
  const headerLabel = cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => movePeriod(-1)} aria-label="Previous period" className="rounded-xl border border-slate-200 p-2 hover:bg-slate-50">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <h2 className="text-sm font-bold text-[#1E3A5F] min-w-36 text-center">{headerLabel}</h2>
          <button type="button" onClick={() => movePeriod(1)} aria-label="Next period" className="rounded-xl border border-slate-200 p-2 hover:bg-slate-50">
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setCursor(new Date())} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            Today
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter calendar events"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-[#F4F7FB] px-3 py-1.5 text-xs font-medium text-slate-800"
          >
            <option value="">All Schedule Items</option>
            <option value="upcoming_inspection">Upcoming Inspections</option>
            <option value="maintenance_deadline">Task Deadlines</option>
            <option value="completed_activity">Completed Activities</option>
          </select>

          <div className="inline-flex rounded-xl border border-slate-200 bg-[#F4F7FB] p-0.5" role="group" aria-label="Calendar view switch">
            <button
              type="button"
              onClick={() => setViewMode('month')}
              className={`rounded-lg px-3 py-1 text-xs font-semibold ${viewMode === 'month' ? 'bg-white text-[#1E3A5F] shadow-xs' : 'text-slate-600'}`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setViewMode('week')}
              className={`rounded-lg px-3 py-1 text-xs font-semibold ${viewMode === 'week' ? 'bg-white text-[#1E3A5F] shadow-xs' : 'text-slate-600'}`}
            >
              Weekly
            </button>
          </div>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="rounded-2xl border border-slate-200/80 bg-white overflow-hidden shadow-xs">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-[#F4F7FB] text-center text-[11px] font-semibold text-slate-600 py-2">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 divide-x divide-y divide-slate-100">
          {days.map((day) => {
            const iso = toIsoDate(day);
            const dayEvents = filteredEvents.filter((e) => e.date === iso);
            const isToday = iso === todayIso;
            const inCurrentMonth = day.getMonth() === cursor.getMonth();
            return (
              <div
                key={iso}
                className={`p-2 ${viewMode === 'week' ? 'min-h-44' : 'min-h-24'} ${inCurrentMonth || viewMode === 'week' ? 'bg-white' : 'bg-slate-50/70'}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${isToday ? 'bg-[#1E3A5F] text-white' : 'text-slate-700'}`}>
                    {day.getDate()}
                  </span>
                </div>
                <div className="space-y-1">
                  {dayEvents.slice(0, viewMode === 'week' ? 8 : 3).map((ev) => (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => setSelectedEvent(ev)}
                      className={`w-full text-left truncate rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${EVENT_COLORS[ev.type] || 'bg-slate-100 text-slate-700 border-slate-200'}`}
                    >
                      {ev.title}
                    </button>
                  ))}
                  {dayEvents.length > (viewMode === 'week' ? 8 : 3) && (
                    <span className="block text-[10px] text-slate-500 pl-1">+{dayEvents.length - 3} more</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selectedEvent && (
        <div className="rounded-2xl border border-sky-200 bg-white p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-start gap-3">
            <CalendarDays className="h-5 w-5 text-sky-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="font-bold text-slate-900 text-sm">{selectedEvent.title}</p>
              <p className="text-slate-600">{selectedEvent.subtitle}</p>
              <p className="text-slate-500 mt-0.5">Date: <strong className="tabular-nums">{selectedEvent.date}</strong></p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge value={selectedEvent.status} />
            <button type="button" onClick={() => navigate(selectedEvent.link)} className="rounded-xl bg-[#1E3A5F] px-3 py-1.5 font-semibold text-white hover:bg-[#284B78]">
              Open Page
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
