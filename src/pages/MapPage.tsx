import React, { useCallback, useEffect, useState } from 'react';
import { Info, MapPin, Navigation, ZoomIn, ZoomOut } from 'lucide-react';
import { CardSkeleton, EmptyState, ProvenanceBadge, StatusBadge } from '../components/ui/Badges';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api, ApiError } from '../lib/api';
import type { RailwayAsset } from '../types';

const MARKER_COLORS: Record<string, string> = {
  Good: '#10B981',
  'Needs Attention': '#F59E0B',
  'Under Repair': '#3B82F6',
  'Critical Alert': '#EF4444',
};

export function MapPage() {
  const { user } = useAuth();
  const { pushToast } = useToast();
  const [assets, setAssets] = useState<RailwayAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<RailwayAsset | null>(null);
  const [zoom, setZoom] = useState(1);

  // Form to add verified coordinates to an existing asset
  const [coordAssetId, setCoordAssetId] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ items: RailwayAsset[] }>('/api/assets?page_size=100');
      setAssets(res.items);
      const firstUnverified = res.items.find((a) => !a.coordinates_verified);
      if (firstUnverified && !coordAssetId) setCoordAssetId(String(firstUnverified.id));
    } catch (err) {
      pushToast('error', 'Could not load map assets', err instanceof ApiError ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [coordAssetId, pushToast]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  const verifiedAssets = assets.filter(
    (a) => Boolean(a.coordinates_verified) && a.latitude !== null && a.longitude !== null,
  );
  const unverifiedAssets = assets.filter(
    (a) => !a.coordinates_verified || a.latitude === null || a.longitude === null,
  );

  // Compute bounding box purely from verified stored coordinates (never fake routes)
  const lats = verifiedAssets.map((a) => a.latitude as number);
  const lons = verifiedAssets.map((a) => a.longitude as number);
  const minLat = lats.length ? Math.min(...lats) : 0;
  const maxLat = lats.length ? Math.max(...lats) : 1;
  const minLon = lons.length ? Math.min(...lons) : 0;
  const maxLon = lons.length ? Math.max(...lons) : 1;
  const latSpan = Math.max(0.02, maxLat - minLat);
  const lonSpan = Math.max(0.02, maxLon - minLon);

  const projectPoint = (aLat: number, aLon: number) => {
    if (verifiedAssets.length === 1) return { x: 320, y: 190 };
    const pad = 65;
    const w = 640 - pad * 2;
    const h = 380 - pad * 2;
    const x = pad + ((aLon - minLon) / lonSpan) * w;
    const y = pad + (1 - (aLat - minLat) / latSpan) * h;
    return { x, y };
  };

  const handleSaveCoords = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!coordAssetId || !confirmed) return;
    const latNum = Number(lat);
    const lonNum = Number(lon);
    if (Number.isNaN(latNum) || Number.isNaN(lonNum) || latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) {
      pushToast('warning', 'Invalid coordinates', 'Enter valid latitude (-90 to 90) and longitude (-180 to 180).');
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/api/assets/${coordAssetId}`, {
        latitude: latNum,
        longitude: lonNum,
        coordinates_verified: true,
      });
      pushToast('success', 'Verified location saved', 'Asset marker is now shown on the map.');
      setLat('');
      setLon('');
      setConfirmed(false);
      await loadAssets();
    } catch (err) {
      pushToast('error', 'Could not save location', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <CardSkeleton rows={6} />;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 flex items-start gap-3 text-xs text-slate-700">
        <Info className="h-4 w-4 text-sky-700 shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <strong className="text-[#1E3A5F]">Verified Locations Only:</strong> This map only shows assets that have
          verified latitude and longitude coordinates saved in your database. No fake railway lines or guessed locations are shown.
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Interactive Map Canvas */}
        <section className="lg:col-span-8 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-wrap text-xs">
              {Object.entries(MARKER_COLORS).map(([label, color]) => (
                <span key={label} className="inline-flex items-center gap-1.5 text-slate-700">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
                  {label}
                </span>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.8, Number((z - 0.2).toFixed(1))))}
                aria-label="Zoom out map"
                className="rounded-lg border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-50"
              >
                <ZoomOut className="h-4 w-4" aria-hidden="true" />
              </button>
              <span className="text-xs font-medium text-slate-600 tabular-nums px-1">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(2.2, Number((z + 0.2).toFixed(1))))}
                aria-label="Zoom in map"
                className="rounded-lg border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-50"
              >
                <ZoomIn className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {verifiedAssets.length === 0 ? (
            <EmptyState
              icon={<MapPin className="h-5 w-5" aria-hidden="true" />}
              title="No verified map coordinates saved yet"
              description="Add verified GPS coordinates to any railway asset using the form on the right to see clickable markers here."
            />
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-[#F4F7FB] overflow-hidden">
              <svg
                viewBox="0 0 640 380"
                className="w-full h-80 sm:h-96"
                role="img"
                aria-label="Interactive Railway Asset Coordinate Map"
              >
                {/* Coordinate grid */}
                {[95, 190, 285].map((y) => (
                  <line key={`h-${y}`} x1="0" y1={y} x2="640" y2={y} stroke="#E2E8F0" strokeDasharray="4 4" />
                ))}
                {[160, 320, 480].map((x) => (
                  <line key={`v-${x}`} x1={x} y1="0" x2={x} y2="380" stroke="#E2E8F0" strokeDasharray="4 4" />
                ))}

                <g transform={`translate(${320 * (1 - zoom)}, ${190 * (1 - zoom)}) scale(${zoom})`}>
                  {verifiedAssets.map((a) => {
                    const pt = projectPoint(a.latitude as number, a.longitude as number);
                    const color = MARKER_COLORS[a.current_condition] || '#1E3A5F';
                    const isSelected = selected?.id === a.id;
                    return (
                      <g
                        key={a.id}
                        tabIndex={0}
                        role="button"
                        aria-label={`${a.asset_code} ${a.name}, Condition: ${a.current_condition}`}
                        onClick={() => setSelected(a)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelected(a);
                          }
                        }}
                        className="cursor-pointer outline-none"
                      >
                        <circle cx={pt.x} cy={pt.y} r={isSelected ? 15 : 11} fill={color} opacity="0.22" />
                        <circle cx={pt.x} cy={pt.y} r={isSelected ? 9 : 7} fill={color} stroke="#FFFFFF" strokeWidth="2.5" />
                        <text x={pt.x} y={pt.y - 13} textAnchor="middle" fontSize="10" fontWeight="700" fill="#1E3A5F">
                          {a.asset_code}
                        </text>
                      </g>
                    );
                  })}
                </g>
              </svg>
            </div>
          )}

          {selected && (
            <div className="rounded-xl border border-sky-200 bg-sky-50/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div>
                <div className="flex items-center gap-2">
                  <code className="font-bold text-[#1E3A5F]">{selected.asset_code}</code>
                  <ProvenanceBadge isDemo={selected.is_demo} />
                  <StatusBadge value={selected.current_condition} />
                </div>
                <p className="text-sm font-bold text-slate-900 mt-1">{selected.name}</p>
                <p className="text-slate-600">{selected.section_location} · GPS: {selected.latitude}, {selected.longitude}</p>
              </div>
              <div className="text-right text-slate-600">
                <p>Status: <strong>{selected.maintenance_status}</strong></p>
                <p>Next Check: <strong>{selected.next_inspection_date || 'Not set'}</strong></p>
              </div>
            </div>
          )}
        </section>

        {/* Verified Coordinates Panel */}
        <aside className="lg:col-span-4 space-y-4">
          {user?.role !== 'staff' && unverifiedAssets.length > 0 && (
            <form onSubmit={(e) => void handleSaveCoords(e)} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs space-y-3 text-xs">
              <div className="flex items-center gap-2">
                <Navigation className="h-4 w-4 text-[#1E3A5F]" aria-hidden="true" />
                <h2 className="text-sm font-bold text-[#1E3A5F]">Add Verified GPS Location</h2>
              </div>
              <p className="text-slate-600">Save real GPS coordinates for an asset to show it on the map.</p>

              <div>
                <label htmlFor="map-asset" className="block font-semibold text-slate-700">Choose Asset</label>
                <select id="map-asset" value={coordAssetId} onChange={(e) => setCoordAssetId(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs">
                  {assets.map((a) => <option key={a.id} value={String(a.id)}>{a.asset_code} — {a.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="map-lat" className="block font-semibold text-slate-700">Latitude</label>
                  <input id="map-lat" type="number" step="any" required value={lat} onChange={(e) => setLat(e.target.value)} placeholder="28.6139" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-1.5 text-xs" />
                </div>
                <div>
                  <label htmlFor="map-lon" className="block font-semibold text-slate-700">Longitude</label>
                  <input id="map-lon" type="number" step="any" required value={lon} onChange={(e) => setLon(e.target.value)} placeholder="77.2090" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-1.5 text-xs" />
                </div>
              </div>
              <label className="inline-flex items-center gap-2 text-slate-700">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="h-4 w-4 rounded" />
                Confirm these coordinates are verified.
              </label>
              <button type="submit" disabled={saving || !confirmed} className="w-full rounded-xl bg-[#1E3A5F] px-3 py-2 font-semibold text-white hover:bg-[#284B78] disabled:opacity-50">
                {saving ? 'Saving...' : 'Save Location to Map'}
              </button>
            </form>
          )}

          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs space-y-3 text-xs">
            <h2 className="text-sm font-bold text-[#1E3A5F]">Assets Without Map Coordinates ({unverifiedAssets.length})</h2>
            {unverifiedAssets.length === 0 ? (
              <p className="text-slate-500">All assets have verified GPS coordinates stored.</p>
            ) : (
              <ul tabIndex={0} aria-label="Assets without map coordinates" className="space-y-2 max-h-60 overflow-y-auto">
                {unverifiedAssets.map((a) => (
                  <li key={a.id} className="rounded-xl border border-slate-100 bg-[#F4F7FB] px-3 py-2 flex items-center justify-between gap-2">
                    <div>
                      <strong className="text-slate-800">{a.asset_code}</strong>
                      <span className="block text-[11px] text-slate-600">{a.section_location}</span>
                    </div>
                    <StatusBadge value={a.current_condition} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
