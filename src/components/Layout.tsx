import React, { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Bell,
  CalendarDays,
  ClipboardCheck,
  Database,
  FileText,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Search,
  TrainTrack,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import type { GlobalSearchResults, NotificationItem } from '../types';
import { RailyAssistant } from './RailyAssistant';

export function AppLayout({ title, children }: { title: string; children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  // Global search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GlobalSearchResults | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
    setNotifOpen(false);
    setSearchOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    let active = true;
    api
      .get<{ items: NotificationItem[] }>('/api/notifications')
      .then((res) => {
        if (active) setNotifications(res.items);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [location.pathname]);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setSearchResults(null);
      return;
    }
    const timer = window.setTimeout(() => {
      api
        .get<GlobalSearchResults>(`/api/search?q=${encodeURIComponent(trimmed)}`)
        .then((res) => {
          setSearchResults(res);
          setSearchOpen(true);
        })
        .catch(() => {});
    }, 220);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const markRead = async (item: NotificationItem) => {
    try {
      await api.patch(`/api/notifications/${item.id}/read`);
      setNotifications((prev) => prev.map((n) => (n.id === item.id ? { ...n, is_read: 1 } : n)));
    } catch {
      // ignore
    }
    setNotifOpen(false);
    navigate(item.link_path || '/');
  };

  const navItems = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'inspector', 'engineer', 'staff'] },
    { to: '/assets', label: 'Railway Assets', icon: Database, roles: ['admin', 'inspector', 'engineer', 'staff'] },
    { to: '/inspections', label: 'Manage Inspections', icon: ClipboardCheck, roles: ['admin', 'inspector', 'engineer', 'staff'] },
    { to: '/maintenance', label: 'Maintenance Tasks', icon: Wrench, roles: ['admin', 'inspector', 'engineer', 'staff'] },
    { to: '/map', label: 'Asset Map', icon: MapPin, roles: ['admin', 'inspector', 'engineer', 'staff'] },
    { to: '/calendar', label: 'Schedule Calendar', icon: CalendarDays, roles: ['admin', 'inspector', 'engineer', 'staff'] },
    { to: '/analytics', label: 'Analytics & Trends', icon: BarChart3, roles: ['admin', 'inspector', 'engineer', 'staff'] },
    { to: '/predictive', label: 'Predictive Maintenance', icon: Activity, roles: ['admin', 'inspector', 'engineer', 'staff'] },
    { to: '/reports', label: 'Reports', icon: FileText, roles: ['admin', 'inspector', 'engineer'] },
    { to: '/notifications', label: 'Notifications', icon: Bell, roles: ['admin', 'inspector', 'engineer', 'staff'] },
    { to: '/team', label: 'Team Management', icon: Users, roles: ['admin'] },
  ].filter((item) => (user ? item.roles.includes(user.role) : false));

  const sidebarContent = (
    <div className="flex h-full flex-col bg-[#1E3A5F] text-slate-100">
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#3B82F6] text-white shrink-0 shadow-xs">
          <TrainTrack className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold tracking-tight text-white">RailPulse AI</p>
          <p className="text-[11px] text-sky-200 truncate">Railway Care Portal</p>
        </div>
      </div>

      <nav aria-label="Main Menu" className="flex-1 space-y-1 px-3 py-4 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-sky-500/25 text-white border border-sky-300/30'
                    : 'text-sky-100/85 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{item.label}</span>
              {item.to === '/notifications' && unreadCount > 0 && (
                <span className="ml-auto rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-slate-900 tabular-nums">
                  {unreadCount}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-4 space-y-3">
        {user && (
          <div className="rounded-xl bg-white/10 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-white truncate">{user.full_name}</p>
              {user.is_demo && (
                <span className="rounded-full bg-violet-300/25 px-2 py-0.5 text-[10px] font-bold text-violet-100">
                  DEMO
                </span>
              )}
            </div>
            <p className="text-[11px] text-sky-100 truncate">{user.role_display}</p>
            <p className="text-[10px] text-sky-100 truncate mt-0.5">{user.department}</p>
          </div>
        )}
        <button
          type="button"
          onClick={() => void logout()}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-xs font-semibold text-sky-100 hover:bg-white/10"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          Sign Out
        </button>
      </div>
    </div>
  );

  const hasAnySearchHit =
    searchResults &&
    (searchResults.assets.length > 0 ||
      searchResults.inspections.length > 0 ||
      searchResults.tasks.length > 0 ||
      searchResults.team.length > 0 ||
      searchResults.reports.length > 0);

  return (
    <div className="min-h-screen flex bg-[#F4F7FB] text-slate-800">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <aside className="hidden lg:block w-64 shrink-0 border-r border-slate-200/80">{sidebarContent}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="fixed inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
          <div className="relative w-64 max-w-[80vw] h-full z-10">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
              className="absolute right-3 top-3 rounded-lg p-1.5 text-sky-100 hover:bg-white/10 hover:text-white z-20"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
            {sidebarContent}
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200/80 bg-white/95 backdrop-blur-xs px-4 sm:px-6 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              className="rounded-xl border border-slate-200 p-2 text-slate-700 hover:bg-slate-50 lg:hidden"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold text-[#1E3A5F] truncate">{title}</h1>
            </div>
          </div>

          {/* Global Search */}
          <div className="relative flex-1 max-w-md hidden sm:block">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
            <label htmlFor="global-search" className="sr-only">
              Search assets, inspections, tasks, team, or reports
            </label>
            <input
              id="global-search"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => {
                if (searchResults) setSearchOpen(true);
              }}
              placeholder="Search assets, inspections, tasks, team..."
              className="w-full rounded-xl border border-slate-200 bg-[#F4F7FB] pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#2563EB] focus:bg-white focus:outline-none"
            />
            {searchOpen && searchResults && (
              <div
                role="region"
                aria-label="Search results"
                className="absolute left-0 right-0 mt-1.5 rounded-2xl border border-slate-200 bg-white shadow-xl z-50 max-h-96 overflow-y-auto p-3 space-y-3 text-xs"
              >
                <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                  <span className="font-semibold text-slate-700">Search Results</span>
                  <button
                    type="button"
                    onClick={() => setSearchOpen(false)}
                    className="text-slate-400 hover:text-slate-700"
                    aria-label="Close search results"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>

                {!hasAnySearchHit ? (
                  <p className="text-slate-500 py-2">No matching records found for &ldquo;{searchQuery}&rdquo;.</p>
                ) : (
                  <>
                    {searchResults.assets.length > 0 && (
                      <div>
                        <p className="font-bold text-[10px] uppercase text-slate-500 mb-1">Railway Assets</p>
                        {searchResults.assets.map((a) => (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() => {
                              setSearchOpen(false);
                              navigate('/assets');
                            }}
                            className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-sky-50 flex justify-between"
                          >
                            <span className="font-medium text-slate-800">{a.asset_code} — {a.name}</span>
                            <span className="text-slate-500">{a.current_condition}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {searchResults.inspections.length > 0 && (
                      <div>
                        <p className="font-bold text-[10px] uppercase text-slate-500 mb-1">Inspections</p>
                        {searchResults.inspections.map((i) => (
                          <button
                            key={i.id}
                            type="button"
                            onClick={() => {
                              setSearchOpen(false);
                              navigate('/inspections');
                            }}
                            className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-sky-50 flex justify-between"
                          >
                            <span className="font-medium text-slate-800">{i.inspection_code} ({i.asset_code})</span>
                            <span className="text-slate-500">{i.status}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {searchResults.tasks.length > 0 && (
                      <div>
                        <p className="font-bold text-[10px] uppercase text-slate-500 mb-1">Maintenance Tasks</p>
                        {searchResults.tasks.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => {
                              setSearchOpen(false);
                              navigate('/maintenance');
                            }}
                            className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-sky-50 flex justify-between"
                          >
                            <span className="font-medium text-slate-800">{t.work_order_code} — {t.title}</span>
                            <span className="text-slate-500">{t.status}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {searchResults.team.length > 0 && (
                      <div>
                        <p className="font-bold text-[10px] uppercase text-slate-500 mb-1">Team Members</p>
                        {searchResults.team.map((m) => (
                          <div key={m.id} className="rounded-lg px-2 py-1.5 flex justify-between">
                            <span className="font-medium text-slate-800">{m.full_name} ({m.username})</span>
                            <span className="text-slate-500">{m.role_display}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {searchResults.reports.length > 0 && (
                      <div>
                        <p className="font-bold text-[10px] uppercase text-slate-500 mb-1">Reports</p>
                        {searchResults.reports.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => {
                              setSearchOpen(false);
                              navigate('/reports');
                            }}
                            className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-sky-50"
                          >
                            <span className="font-medium text-slate-800">{r.title}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <span className="hidden md:inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-[#1E3A5F]">
              {user?.role_display}
            </span>

            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((p) => !p)}
                aria-label={`Notifications (${unreadCount} unread)`}
                aria-expanded={notifOpen}
                className="relative rounded-xl border border-slate-200 p-2 text-slate-700 hover:bg-slate-50"
              >
                <Bell className="h-4 w-4" aria-hidden="true" />
                {unreadCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white tabular-nums">
                    {unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div
                  role="region"
                  aria-label="Recent notifications"
                  className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 bg-white shadow-xl z-40 overflow-hidden"
                >
                  <div className="border-b border-slate-100 px-4 py-2.5 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-900">Notifications</span>
                    <button
                      type="button"
                      onClick={() => {
                        setNotifOpen(false);
                        navigate('/notifications');
                      }}
                      className="text-[11px] font-semibold text-sky-600 hover:underline"
                    >
                      View all
                    </button>
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                    {notifications.length === 0 ? (
                      <p className="p-4 text-xs text-slate-500">You have no notifications yet.</p>
                    ) : (
                      notifications.slice(0, 6).map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => void markRead(n)}
                          className={`w-full text-left px-4 py-3 hover:bg-sky-50/50 transition-colors ${
                            n.is_read ? 'opacity-70' : 'bg-sky-50/40'
                          }`}
                        >
                          <p className="text-xs font-semibold text-slate-900">{n.title}</p>
                          <p className="text-[11px] text-slate-600 mt-0.5">{n.message}</p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main id="main-content" className="flex-1 p-4 sm:p-6 pb-24 max-w-7xl w-full mx-auto space-y-6">
          {children}
        </main>

        <footer className="border-t border-slate-200/80 bg-white px-6 py-3 text-xs text-slate-500 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 no-print">
          <span>
            RailPulse AI helps railway maintenance teams track assets, inspections, and repairs. It does not replace human safety checks.
          </span>
          <span>Independent software platform — not affiliated with Indian Railways.</span>
        </footer>
      </div>

      <RailyAssistant />
    </div>
  );
}
