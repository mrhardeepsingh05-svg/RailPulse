import React from 'react';

const STATUS_STYLES: Record<string, string> = {
  Good: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Resolved: 'bg-emerald-50 text-emerald-700 border-emerald-200',

  'Needs Attention': 'bg-amber-50 text-amber-700 border-amber-200',
  'Waiting for Review': 'bg-amber-50 text-amber-700 border-amber-200',
  'Maintenance Scheduled': 'bg-violet-50 text-violet-700 border-violet-200',
  Medium: 'bg-amber-50 text-amber-700 border-amber-200',
  High: 'bg-orange-50 text-orange-700 border-orange-200',
  Open: 'bg-amber-50 text-amber-700 border-amber-200',

  'Under Repair': 'bg-sky-50 text-sky-700 border-sky-200',
  'In Progress': 'bg-sky-50 text-sky-700 border-sky-200',
  Assigned: 'bg-sky-50 text-sky-700 border-sky-200',
  New: 'bg-violet-50 text-violet-700 border-violet-200',
  Low: 'bg-slate-100 text-slate-700 border-slate-200',

  'Critical Alert': 'bg-rose-50 text-rose-700 border-rose-200',
  'Out of Service': 'bg-rose-50 text-rose-700 border-rose-200',
  'Needs Follow-up': 'bg-rose-50 text-rose-700 border-rose-200',
  Critical: 'bg-rose-50 text-rose-700 border-rose-200',
};

export function StatusBadge({ value }: { value: string }) {
  const cls = STATUS_STYLES[value] || 'bg-slate-100 text-slate-700 border-slate-200';
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {value}
    </span>
  );
}

export function ProvenanceBadge({ isDemo }: { isDemo: boolean | number }) {
  return isDemo ? (
    <span
      title="Sample demonstration record"
      className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-bold tracking-wide text-violet-700 uppercase"
    >
      DEMO DATA
    </span>
  ) : (
    <span
      title="Saved live record"
      className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-bold tracking-wide text-sky-700 uppercase"
    >
      LIVE DATA
    </span>
  );
}

export function CardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 space-y-3 shadow-xs animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="h-4 w-1/3 rounded bg-slate-200" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-3.5 w-full rounded bg-slate-100" />
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-xs">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm text-slate-600 max-w-md mx-auto">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
