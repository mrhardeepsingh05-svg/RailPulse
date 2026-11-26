import { useState } from 'react';

interface BarItem {
  label: string;
  value: number;
  color: string;
}

export function HorizontalBarChart({
  title,
  items,
  ariaLabel,
}: {
  title: string;
  items: BarItem[];
  ariaLabel: string;
}) {
  const maxVal = Math.max(1, ...items.map((i) => i.value));

  return (
    <div className="space-y-3" role="region" aria-label={ariaLabel}>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <div className="space-y-2.5">
        {items.map((item) => {
          const pct = Math.round((item.value / maxVal) * 100);
          return (
            <div key={item.label} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700 truncate pr-2">{item.label}</span>
                <span className="font-semibold text-slate-900 tabular-nums">{item.value}</span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={item.value} aria-valuemin={0} aria-valuemax={maxVal} aria-label={`${item.label}: ${item.value}`}>
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${item.value === 0 ? 0 : Math.max(4, pct)}%`, backgroundColor: item.color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface TrendPoint {
  month: string;
  total: number;
  approved: number;
  pending: number;
}

export function InspectionTrendChart({ data }: { data: TrendPoint[] }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!data.length) {
    return (
      <p className="text-sm text-slate-500 py-8 text-center">
        No inspection trend records stored yet.
      </p>
    );
  }

  const maxVal = Math.max(1, ...data.map((d) => d.total));
  const chartW = 520;
  const chartH = 200;
  const padL = 34;
  const padR = 16;
  const padT = 16;
  const padB = 34;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;
  const slotW = innerW / data.length;
  const barW = Math.min(34, Math.max(14, slotW * 0.45));

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-4 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-[#1D4ED8]" aria-hidden="true" />
            Total Submitted
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-[#15803D]" aria-hidden="true" />
            Approved
          </span>
        </div>
        {hoveredIdx !== null && data[hoveredIdx] && (
          <span className="text-xs font-medium text-slate-700 tabular-nums">
            {data[hoveredIdx].month}: {data[hoveredIdx].total} total, {data[hoveredIdx].approved} approved
          </span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${chartW} ${chartH}`}
        className="w-full h-52 overflow-visible"
        role="img"
        aria-label="Inspection submission and approval trends by month"
      >
        {[0, 0.5, 1].map((ratio) => {
          const y = padT + innerH * (1 - ratio);
          const labelVal = Math.round(maxVal * ratio);
          return (
            <g key={ratio}>
              <line x1={padL} y1={y} x2={chartW - padR} y2={y} stroke="#E2E8F0" strokeDasharray="3 3" />
              <text x={padL - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#64748B">
                {labelVal}
              </text>
            </g>
          );
        })}

        {data.map((d, idx) => {
          const cx = padL + slotW * idx + slotW / 2;
          const totalH = (d.total / maxVal) * innerH;
          const approvedH = (d.approved / maxVal) * innerH;
          const totalX = cx - barW / 2 - 2;
          const approvedX = cx + 2;
          return (
            <g
              key={d.month}
              tabIndex={0}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              onFocus={() => setHoveredIdx(idx)}
              onBlur={() => setHoveredIdx(null)}
              className="cursor-pointer outline-none"
            >
              <title>{`${d.month}: ${d.total} submitted, ${d.approved} approved, ${d.pending} pending`}</title>
              <rect
                x={totalX}
                y={padT + innerH - totalH}
                width={barW * 0.55}
                height={Math.max(2, totalH)}
                rx={3}
                fill="#1D4ED8"
              />
              <rect
                x={approvedX}
                y={padT + innerH - approvedH}
                width={barW * 0.55}
                height={Math.max(2, approvedH)}
                rx={3}
                fill="#15803D"
              />
              <text x={cx} y={chartH - 10} textAnchor="middle" fontSize="10" fill="#475569">
                {d.month}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
