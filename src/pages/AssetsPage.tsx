import React, { useCallback, useEffect, useState } from 'react';
import { Database, Edit3, Eye, MapPin, Plus, Search, Upload, X } from 'lucide-react';
import { CardSkeleton, EmptyState, ProvenanceBadge, StatusBadge } from '../components/ui/Badges';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api, ApiError } from '../lib/api';
import type {
  AssetCategory,
  AssetCondition,
  AssetOperationalStatus,
  FaultReport,
  Inspection,
  RailwayAsset,
  StoredImage,
  WorkOrder,
} from '../types';

interface TeamOption {
  id: number;
  full_name: string;
  role: string;
}

interface AssetDetailResponse {
  asset: RailwayAsset;
  images: StoredImage[];
  inspections: Inspection[];
  faults: FaultReport[];
  work_orders: WorkOrder[];
}

const CONDITION_OPTIONS: AssetCondition[] = ['Good', 'Needs Attention', 'Under Repair', 'Critical Alert'];
const STATUS_OPTIONS: AssetOperationalStatus[] = ['Active', 'Maintenance Scheduled', 'Under Repair', 'Out of Service'];

function AuthAssetImage({ storedFilename, alt }: { storedFilename: string; alt: string }) {
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
  if (!src) return <div className="h-20 w-28 rounded-xl border border-slate-200 bg-slate-100 animate-pulse" />;
  return <img src={src} alt={alt} className="h-20 w-28 rounded-xl border border-slate-200 object-cover" />;
}

export function AssetsPage() {
  const { user } = useAuth();
  const { pushToast } = useToast();

  const [assets, setAssets] = useState<RailwayAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [conditionFilter, setConditionFilter] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [page, setPage] = useState(1);

  const [showModal, setShowModal] = useState(false);
  const [editingAsset, setEditingAsset] = useState<RailwayAsset | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<AssetDetailResponse | null>(null);

  // Form state
  const [formCode, setFormCode] = useState('');
  const [formName, setFormName] = useState('');
  const [formCategoryId, setFormCategoryId] = useState('');
  const [formLocation, setFormLocation] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formInstallDate, setFormInstallDate] = useState('');
  const [formRegDate, setFormRegDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formNextInspDate, setFormNextInspDate] = useState('');
  const [formCondition, setFormCondition] = useState<AssetCondition>('Good');
  const [formStatus, setFormStatus] = useState<AssetOperationalStatus>('Active');
  const [formEngineerId, setFormEngineerId] = useState('');
  const [formLat, setFormLat] = useState('');
  const [formLon, setFormLon] = useState('');
  const [formCoordsVerified, setFormCoordsVerified] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('q', search.trim());
      if (categoryFilter) params.set('category_id', categoryFilter);
      if (conditionFilter) params.set('condition', conditionFilter);
      params.set('sort_by', sortBy);
      params.set('page', String(page));
      params.set('page_size', '12');

      const res = await api.get<{ total: number; items: RailwayAsset[] }>(`/api/assets?${params.toString()}`);
      setAssets(res.items);
      setTotal(res.total);
    } catch (err) {
      pushToast('error', 'Could not load assets', err instanceof ApiError ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [search, categoryFilter, conditionFilter, sortBy, page, pushToast]);

  useEffect(() => {
    Promise.all([
      api.get<{ items: AssetCategory[] }>('/api/categories'),
      api.get<{ items: TeamOption[] }>('/api/team/members'),
    ])
      .then(([cats, members]) => {
        setCategories(cats.items);
        setTeamMembers(members.items.filter((m) => m.role === 'engineer' || m.role === 'staff'));
        if (cats.items[0] && !formCategoryId) setFormCategoryId(String(cats.items[0].id));
      })
      .catch(() => {});
  }, [formCategoryId]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  const openCreateModal = () => {
    setEditingAsset(null);
    setFormCode('');
    setFormName('');
    setFormCategoryId(categories[0] ? String(categories[0].id) : '');
    setFormLocation('');
    setFormDesc('');
    setFormInstallDate('');
    setFormRegDate(new Date().toISOString().slice(0, 10));
    setFormNextInspDate('');
    setFormCondition('Good');
    setFormStatus('Active');
    setFormEngineerId('');
    setFormLat('');
    setFormLon('');
    setFormCoordsVerified(false);
    setShowModal(true);
  };

  const openEditModal = (a: RailwayAsset) => {
    setEditingAsset(a);
    setFormCode(a.asset_code);
    setFormName(a.name);
    setFormCategoryId(String(a.category_id));
    setFormLocation(a.section_location);
    setFormDesc(a.description);
    setFormInstallDate(a.installation_date || '');
    setFormRegDate(a.registration_date);
    setFormNextInspDate(a.next_inspection_date || '');
    setFormCondition(a.current_condition);
    setFormStatus(a.maintenance_status);
    setFormEngineerId(a.assigned_engineer_id ? String(a.assigned_engineer_id) : '');
    setFormLat(a.latitude !== null ? String(a.latitude) : '');
    setFormLon(a.longitude !== null ? String(a.longitude) : '');
    setFormCoordsVerified(Boolean(a.coordinates_verified));
    setShowModal(true);
  };

  const handleSaveAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formName.trim().length < 3 || formLocation.trim().length < 3) {
      pushToast('warning', 'Check your inputs', 'Asset name and location must be at least 3 characters.');
      return;
    }
    const latNum = formLat.trim() ? Number(formLat) : null;
    const lonNum = formLon.trim() ? Number(formLon) : null;
    if ((latNum !== null && Number.isNaN(latNum)) || (lonNum !== null && Number.isNaN(lonNum))) {
      pushToast('warning', 'Invalid coordinates', 'Latitude and longitude must be valid numbers.');
      return;
    }

    setSaving(true);
    try {
      const commonPayload = {
        name: formName.trim(),
        category_id: Number(formCategoryId),
        section_location: formLocation.trim(),
        description: formDesc.trim(),
        installation_date: formInstallDate || null,
        next_inspection_date: formNextInspDate || null,
        current_condition: formCondition,
        maintenance_status: formStatus,
        latitude: latNum,
        longitude: lonNum,
        coordinates_verified: formCoordsVerified && latNum !== null && lonNum !== null,
        assigned_engineer_id: formEngineerId ? Number(formEngineerId) : null,
      };

      if (editingAsset) {
        await api.patch(`/api/assets/${editingAsset.id}`, commonPayload);
        pushToast('success', 'Asset updated', `${editingAsset.asset_code} changes saved.`);
      } else {
        const created = await api.post<RailwayAsset>('/api/assets', {
          ...commonPayload,
          asset_code: formCode.trim() ? formCode.trim().toUpperCase() : undefined,
          registration_date: formRegDate,
        });
        pushToast('success', 'Asset added', `${created.asset_code} has been saved.`);
      }
      setShowModal(false);
      await loadAssets();
    } catch (err) {
      pushToast('error', 'Could not save asset', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const openProfile = async (assetId: number) => {
    try {
      const detail = await api.get<AssetDetailResponse>(`/api/assets/${assetId}`);
      setSelectedProfile(detail);
    } catch (err) {
      pushToast('error', 'Could not open asset details', err instanceof ApiError ? err.message : undefined);
    }
  };

  const handleUploadAssetImage = async (assetId: number, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append('files', f));
    try {
      await api.post(`/api/assets/${assetId}/images`, fd);
      pushToast('success', 'Photo attached', 'Asset photo saved.');
      await openProfile(assetId);
      await loadAssets();
    } catch (err) {
      pushToast('error', 'Upload failed', err instanceof ApiError ? err.message : undefined);
    }
  };

  const canCreate = user?.role !== 'staff';
  const canEdit = (a: RailwayAsset) => {
    if (!user) return false;
    if (user.role === 'admin' || user.role === 'engineer' || user.role === 'inspector') return true;
    return user.role === 'staff' && a.assigned_engineer_id === user.id;
  };

  return (
    <div className="space-y-5">
      {/* Search, Filter & Sort Toolbar */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs flex flex-col xl:flex-row xl:items-center gap-3 justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
            <label htmlFor="asset-search" className="sr-only">Search assets</label>
            <input
              id="asset-search"
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by Asset ID, name, or location..."
              className="w-full rounded-xl border border-slate-200 bg-[#F4F7FB] pl-9 pr-3 py-2 text-xs text-slate-900 focus:border-[#2563EB] focus:bg-white focus:outline-none"
            />
          </div>

          <select
            aria-label="Filter by asset type"
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-xl border border-slate-200 bg-[#F4F7FB] px-3 py-2 text-xs font-medium text-slate-800"
          >
            <option value="">All Asset Types</option>
            {categories.map((c) => (
              <option key={c.id} value={String(c.id)}>{c.name}</option>
            ))}
          </select>

          <select
            aria-label="Filter by condition"
            value={conditionFilter}
            onChange={(e) => {
              setConditionFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-xl border border-slate-200 bg-[#F4F7FB] px-3 py-2 text-xs font-medium text-slate-800"
          >
            <option value="">All Conditions</option>
            {CONDITION_OPTIONS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <select
            aria-label="Sort assets"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="rounded-xl border border-slate-200 bg-[#F4F7FB] px-3 py-2 text-xs font-medium text-slate-800"
          >
            <option value="newest">Sort: Newest</option>
            <option value="name">Sort: Name (A–Z)</option>
            <option value="condition">Sort: Condition Priority</option>
            <option value="next_inspection">Sort: Next Check Date</option>
            <option value="last_inspection">Sort: Last Check Date</option>
          </select>
        </div>

        {canCreate && (
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1E3A5F] px-4 py-2 text-xs font-semibold text-white hover:bg-[#284B78] shrink-0"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add Asset
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <CardSkeleton rows={6} />
      ) : assets.length === 0 ? (
        <EmptyState
          icon={<Database className="h-5 w-5" aria-hidden="true" />}
          title="No railway assets found"
          description="Try changing your search filters or add a new railway asset."
        />
      ) : (
        <div className="rounded-2xl border border-slate-200/80 bg-white overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-[#F4F7FB] text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                  <th className="px-4 py-3">Asset ID</th>
                  <th className="px-4 py-3">Name &amp; Location</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Condition &amp; Status</th>
                  <th className="px-4 py-3">Checks</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {assets.map((a) => (
                  <tr key={a.id} className="hover:bg-sky-50/30">
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <div className="flex flex-col gap-1 items-start">
                        <code className="font-mono font-bold text-[#1E3A5F]">{a.asset_code}</code>
                        <ProvenanceBadge isDemo={a.is_demo} />
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <p className="font-semibold text-slate-900 text-sm">{a.name}</p>
                      <p className="text-slate-500 flex items-center gap-1 mt-0.5">
                        {a.section_location}
                        {Boolean(a.coordinates_verified) && (
                          <span title="Verified GPS coordinates stored" className="inline-flex items-center text-emerald-600">
                            <MapPin className="h-3 w-3" aria-hidden="true" />
                          </span>
                        )}
                      </p>
                    </td>
                    <td className="px-4 py-3.5 text-slate-700">{a.category_name}</td>
                    <td className="px-4 py-3.5 space-y-1">
                      <div><StatusBadge value={a.current_condition} /></div>
                      <div><StatusBadge value={a.maintenance_status} /></div>
                    </td>
                    <td className="px-4 py-3.5 tabular-nums text-slate-600">
                      <span className="block">Last: {a.last_inspection_date || 'None'}</span>
                      <span className="block text-slate-500">Next: {a.next_inspection_date || 'Not set'}</span>
                    </td>
                    <td className="px-4 py-3.5 text-right whitespace-nowrap space-x-1.5">
                      <button
                        type="button"
                        onClick={() => void openProfile(a.id)}
                        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        View
                      </button>
                      {canEdit(a) && (
                        <button
                          type="button"
                          onClick={() => openEditModal(a)}
                          className="inline-flex items-center gap-1 rounded-xl border border-sky-200 bg-sky-50 px-3 py-1.5 font-medium text-sky-700 hover:bg-sky-100"
                        >
                          <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t border-slate-200 px-4 py-3 flex items-center justify-between text-xs text-slate-600">
            <span>Showing {assets.length} of {total} assets</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded-lg border border-slate-200 px-3 py-1 disabled:opacity-40"
              >
                Previous
              </button>
              <span className="tabular-nums">Page {page}</span>
              <button
                type="button"
                disabled={page * 12 >= total}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-lg border border-slate-200 px-3 py-1 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-label={editingAsset ? 'Edit Asset' : 'Add Asset'}>
          <div className="w-full max-w-2xl rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between bg-[#1E3A5F] px-5 py-4 text-white">
              <h2 className="text-sm font-bold">{editingAsset ? `Edit ${editingAsset.asset_code}` : 'Add New Railway Asset'}</h2>
              <button type="button" onClick={() => setShowModal(false)} aria-label="Close window" className="rounded p-1 hover:bg-white/10">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSaveAsset(e)} className="p-5 space-y-4 max-h-[82vh] overflow-y-auto text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {!editingAsset && (
                  <div>
                    <label htmlFor="f-code" className="block font-semibold text-slate-700">Asset ID (optional)</label>
                    <input id="f-code" type="text" value={formCode} onChange={(e) => setFormCode(e.target.value)} placeholder="Auto-generated if empty" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                  </div>
                )}
                <div>
                  <label htmlFor="f-name" className="block font-semibold text-slate-700">Asset Name</label>
                  <input id="f-name" type="text" required value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. East Line Bridge #04" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label htmlFor="f-type" className="block font-semibold text-slate-700">Asset Type</label>
                  <select id="f-type" value={formCategoryId} onChange={(e) => setFormCategoryId(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
                    {categories.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="f-loc" className="block font-semibold text-slate-700">Location</label>
                  <input id="f-loc" type="text" required value={formLocation} onChange={(e) => setFormLocation(e.target.value)} placeholder="e.g. North Section — Km 12.4" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label htmlFor="f-cond" className="block font-semibold text-slate-700">Current Condition</label>
                  <select id="f-cond" value={formCondition} onChange={(e) => setFormCondition(e.target.value as AssetCondition)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
                    {CONDITION_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="f-stat" className="block font-semibold text-slate-700">Current Status</label>
                  <select id="f-stat" value={formStatus} onChange={(e) => setFormStatus(e.target.value as AssetOperationalStatus)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="f-inst" className="block font-semibold text-slate-700">Installation Date (optional)</label>
                  <input id="f-inst" type="date" value={formInstallDate} onChange={(e) => setFormInstallDate(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label htmlFor="f-next" className="block font-semibold text-slate-700">Next Inspection Date</label>
                  <input id="f-next" type="date" value={formNextInspDate} onChange={(e) => setFormNextInspDate(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label htmlFor="f-eng" className="block font-semibold text-slate-700">Assigned Team Member</label>
                  <select id="f-eng" value={formEngineerId} onChange={(e) => setFormEngineerId(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
                    <option value="">Not assigned</option>
                    {teamMembers.map((m) => <option key={m.id} value={String(m.id)}>{m.full_name}</option>)}
                  </select>
                </div>
                {!editingAsset && (
                  <div>
                    <label htmlFor="f-reg" className="block font-semibold text-slate-700">Date Added</label>
                    <input id="f-reg" type="date" required value={formRegDate} onChange={(e) => setFormRegDate(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-[#F4F7FB] p-3 space-y-2">
                <p className="font-semibold text-slate-800">Verified Map Coordinates (Optional — shown on Asset Map only when verified)</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input type="number" step="any" placeholder="Latitude (e.g. 28.6139)" aria-label="Latitude" value={formLat} onChange={(e) => setFormLat(e.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm" />
                  <input type="number" step="any" placeholder="Longitude (e.g. 77.2090)" aria-label="Longitude" value={formLon} onChange={(e) => setFormLon(e.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm" />
                </div>
                <label className="inline-flex items-center gap-2 text-slate-700">
                  <input type="checkbox" checked={formCoordsVerified} onChange={(e) => setFormCoordsVerified(e.target.checked)} className="h-4 w-4 rounded" />
                  I confirm these GPS coordinates are verified and safe to display on the Asset Map.
                </label>
              </div>

              <div>
                <label htmlFor="f-desc" className="block font-semibold text-slate-700">Description</label>
                <textarea id="f-desc" rows={3} value={formDesc} onChange={(e) => setFormDesc(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700">Cancel</button>
                <button type="submit" disabled={saving} className="rounded-xl bg-[#1E3A5F] px-4 py-2 font-semibold text-white hover:bg-[#284B78] disabled:opacity-60">
                  {saving ? 'Saving...' : editingAsset ? 'Save Changes' : 'Save Asset'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Full Asset Details Modal */}
      {selectedProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-label="Asset Details">
          <div className="w-full max-w-3xl rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
            <div className="flex items-center justify-between bg-[#1E3A5F] px-5 py-4 text-white">
              <div>
                <div className="flex items-center gap-2">
                  <code className="text-xs font-bold text-sky-200">{selectedProfile.asset.asset_code}</code>
                  <ProvenanceBadge isDemo={selectedProfile.asset.is_demo} />
                </div>
                <h2 className="text-base font-bold mt-0.5">{selectedProfile.asset.name}</h2>
              </div>
              <button type="button" onClick={() => setSelectedProfile(null)} aria-label="Close details" className="rounded p-1 hover:bg-white/10">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-5 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl bg-[#F4F7FB] border border-slate-200 p-4">
                <div><span className="text-slate-500 block">Asset Type</span><strong className="text-slate-900">{selectedProfile.asset.category_name}</strong></div>
                <div><span className="text-slate-500 block">Location</span><strong className="text-slate-900">{selectedProfile.asset.section_location}</strong></div>
                <div><span className="text-slate-500 block">Installed</span><strong className="text-slate-900 tabular-nums">{selectedProfile.asset.installation_date || 'Not recorded'}</strong></div>
                <div><span className="text-slate-500 block">Next Check</span><strong className="text-slate-900 tabular-nums">{selectedProfile.asset.next_inspection_date || 'Not set'}</strong></div>
                <div><span className="text-slate-500 block">Condition</span><div className="mt-1"><StatusBadge value={selectedProfile.asset.current_condition} /></div></div>
                <div><span className="text-slate-500 block">Status</span><div className="mt-1"><StatusBadge value={selectedProfile.asset.maintenance_status} /></div></div>
                <div><span className="text-slate-500 block">Last Check</span><strong className="text-slate-900 tabular-nums">{selectedProfile.asset.last_inspection_date || 'None'}</strong></div>
                <div><span className="text-slate-500 block">Map Coordinates</span><strong className="text-slate-900 tabular-nums">{selectedProfile.asset.coordinates_verified ? `${selectedProfile.asset.latitude}, ${selectedProfile.asset.longitude}` : 'Not verified'}</strong></div>
              </div>

              {selectedProfile.asset.description && <p className="text-slate-700 leading-relaxed">{selectedProfile.asset.description}</p>}

              {/* Attached Images */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold uppercase tracking-wider text-slate-600">Attached Photos ({selectedProfile.images.length})</h3>
                  {canCreate && (
                    <label className="inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-3 py-1.5 font-semibold text-sky-700 cursor-pointer hover:bg-sky-100">
                      <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                      Attach Photo
                      <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => void handleUploadAssetImage(selectedProfile.asset.id, e.target.files)} className="sr-only" />
                    </label>
                  )}
                </div>
                {selectedProfile.images.length === 0 ? (
                  <p className="text-slate-500">No photos attached to this asset yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {selectedProfile.images.map((img) => (
                      <div key={img.stored_filename} className="space-y-1">
                        <AuthAssetImage storedFilename={img.stored_filename} alt={img.original_filename} />
                        <p className="text-[10px] text-slate-500 truncate max-w-28">{img.original_filename}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Maintenance History */}
              <div>
                <h3 className="font-bold uppercase tracking-wider text-slate-600 mb-2">Maintenance History ({selectedProfile.work_orders.length})</h3>
                {selectedProfile.work_orders.length === 0 ? (
                  <p className="text-slate-500">No maintenance tasks recorded yet.</p>
                ) : (
                  <div className="space-y-2">
                    {selectedProfile.work_orders.map((w) => (
                      <div key={w.id} className="rounded-xl border border-slate-200 p-3 flex items-center justify-between gap-3">
                        <div>
                          <span className="font-semibold text-slate-900">{w.work_order_code}: {w.title}</span>
                          <p className="text-[11px] text-slate-500 mt-0.5">Due {w.due_date} · Assigned to {w.assignee_name || 'Unassigned'}</p>
                        </div>
                        <StatusBadge value={w.status} />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Inspection History */}
              <div>
                <h3 className="font-bold uppercase tracking-wider text-slate-600 mb-2">Inspection History ({selectedProfile.inspections.length})</h3>
                {selectedProfile.inspections.length === 0 ? (
                  <p className="text-slate-500">No inspections recorded yet.</p>
                ) : (
                  <div className="space-y-2">
                    {selectedProfile.inspections.map((ins) => (
                      <div key={ins.id} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900">{ins.inspection_code} — {ins.inspection_category}</span>
                          <StatusBadge value={ins.status} />
                        </div>
                        <p className="text-slate-700 mt-1">{ins.observed_conditions}</p>
                        <p className="text-[11px] text-slate-500 mt-1">Checked on {ins.inspection_date} by {ins.inspector_name}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
