import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  FileImage,
  ShieldAlert,
  Upload,
  X,
} from 'lucide-react';
import { CardSkeleton, EmptyState, ProvenanceBadge, StatusBadge } from '../components/ui/Badges';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api, ApiError } from '../lib/api';
import type { AIAnalysisResult, FaultReport, Inspection, RailwayAsset } from '../types';

const CHECK_TYPES = [
  'Routine Check',
  'Track & Structure Check',
  'Signal Check',
  'Safety & Crossing Check',
  'Urgent Check',
];

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

function AuthInspectionImage({ storedFilename, alt }: { storedFilename: string; alt: string }) {
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

export function InspectionsPage() {
  const { user } = useAuth();
  const { pushToast } = useToast();

  const [tab, setTab] = useState<'history' | 'submit' | 'faults'>('history');
  const [assets, setAssets] = useState<RailwayAsset[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [faults, setFaults] = useState<FaultReport[]>([]);
  const [loading, setLoading] = useState(true);

  const [assetId, setAssetId] = useState('');
  const [inspectionDate, setInspectionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState(CHECK_TYPES[0]);
  const [observed, setObserved] = useState('');
  const [files, setFiles] = useState<{ file: File; preview: string }[]>([]);
  const [reportFault, setReportFault] = useState(false);
  const [faultTitle, setFaultTitle] = useState('');
  const [faultCategory, setFaultCategory] = useState('Track & Fasteners');
  const [faultSeverity, setFaultSeverity] = useState<'Low' | 'Medium' | 'High' | 'Critical'>('Medium');
  const [faultDesc, setFaultDesc] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [aiResult, setAiResult] = useState<AIAnalysisResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [humanAck, setHumanAck] = useState(false);

  const [reviewTarget, setReviewTarget] = useState<Inspection | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [assetRes, inspRes, faultRes] = await Promise.all([
        api.get<{ items: RailwayAsset[] }>('/api/assets?page_size=100'),
        api.get<{ items: Inspection[] }>(statusFilter ? `/api/inspections?status=${encodeURIComponent(statusFilter)}` : '/api/inspections'),
        api.get<{ items: FaultReport[] }>('/api/faults'),
      ]);
      setAssets(assetRes.items);
      if (assetRes.items[0] && !assetId) setAssetId(String(assetRes.items[0].id));
      setInspections(inspRes.items);
      setFaults(faultRes.items);
    } catch (err) {
      pushToast('error', 'Could not load inspections', err instanceof ApiError ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, assetId, pushToast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleFilePick = (selected: FileList | null) => {
    if (!selected) return;
    const next = [...files];
    for (const f of Array.from(selected)) {
      if (next.length >= 5) {
        pushToast('warning', 'Photo limit reached', 'You can attach up to 5 photos.');
        break;
      }
      if (!ALLOWED_MIME.has(f.type)) {
        pushToast('error', 'File not supported', `${f.name} skipped. Please pick a JPG, PNG, or WebP photo.`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        pushToast('error', 'Photo too large', `${f.name} is over 5 MB.`);
        continue;
      }
      next.push({ file: f, preview: URL.createObjectURL(f) });
    }
    setFiles(next);
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => {
      const target = prev[idx];
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const runAiCheck = async () => {
    if (observed.trim().length < 5) {
      pushToast('warning', 'Write your notes first', 'Enter at least 5 characters about what you saw.');
      return;
    }
    setAiLoading(true);
    setHumanAck(false);
    try {
      const fd = new FormData();
      fd.append('observed_conditions', observed.trim());
      fd.append('inspection_category', category);
      if (assetId) fd.append('asset_id', assetId);
      files.forEach((f) => fd.append('files', f.file));
      const res = await api.post<AIAnalysisResult>('/api/ai/analyze', fd);
      setAiResult(res);
    } catch (err) {
      pushToast('error', 'AI check failed', err instanceof ApiError ? err.message : undefined);
    } finally {
      setAiLoading(false);
    }
  };

  const applyAiSuggestion = () => {
    if (!aiResult || !humanAck) return;
    setReportFault(true);
    setFaultCategory(aiResult.suggested_category);
    setFaultSeverity(aiResult.suggested_priority);
    if (!faultTitle) setFaultTitle(`Check: ${aiResult.suggested_category}`);
    if (!faultDesc) setFaultDesc(aiResult.possible_defects_requiring_verification.join(' ') || observed);
    pushToast('info', 'Suggestion added', 'Please check the problem details before saving.');
  };

  const handleSubmitInspection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assetId) {
      pushToast('warning', 'Pick an asset first');
      return;
    }
    if (observed.trim().length < 10) {
      pushToast('warning', 'Notes too short', 'Please write at least 10 characters about what you saw.');
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('asset_id', assetId);
      fd.append('inspection_date', inspectionDate);
      fd.append('inspection_category', category);
      fd.append('observed_conditions', observed.trim());
      fd.append('report_fault', String(reportFault));
      if (reportFault) {
        fd.append('fault_title', faultTitle.trim());
        fd.append('fault_category', faultCategory);
        fd.append('fault_severity', faultSeverity);
        fd.append('fault_description', faultDesc.trim() || observed.trim());
      }
      files.forEach((f) => fd.append('files', f.file));

      const created = await api.post<Inspection & { created_fault_code?: string }>('/api/inspections', fd);
      pushToast('success', `Inspection ${created.inspection_code} saved`, 'Sent for review.');
      files.forEach((f) => URL.revokeObjectURL(f.preview));
      setFiles([]);
      setObserved('');
      setReportFault(false);
      setFaultTitle('');
      setFaultDesc('');
      setAiResult(null);
      setTab('history');
      await loadAll();
    } catch (err) {
      pushToast('error', 'Could not save inspection', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReviewSubmit = async (decision: 'Approved' | 'Needs Follow-up') => {
    if (!reviewTarget) return;
    try {
      await api.patch(`/api/inspections/${reviewTarget.id}/review`, { status: decision, review_notes: reviewNotes });
      pushToast('success', `Marked ${decision}`, `${reviewTarget.inspection_code} updated.`);
      setReviewTarget(null);
      setReviewNotes('');
      await loadAll();
    } catch (err) {
      pushToast('error', 'Could not save review', err instanceof ApiError ? err.message : undefined);
    }
  };

  const handleVerifyFault = async (fault: FaultReport) => {
    try {
      await api.patch(`/api/faults/${fault.id}/verify`, { human_verified: true });
      pushToast('success', 'Confirmed by reviewer', `${fault.fault_code} marked as human verified.`);
      await loadAll();
    } catch (err) {
      pushToast('error', 'Could not verify', err instanceof ApiError ? err.message : undefined);
    }
  };

  const analyzeExistingInspection = async (insp: Inspection) => {
    setAiLoading(true);
    setHumanAck(false);
    try {
      const res = await api.post<AIAnalysisResult>(`/api/ai/analyze-inspection/${insp.id}`);
      setAiResult(res);
    } catch (err) {
      pushToast('error', 'AI check failed', err instanceof ApiError ? err.message : undefined);
    } finally {
      setAiLoading(false);
    }
  };

  const canSubmit = user?.role !== 'staff';
  const canReview = user?.role === 'admin' || user?.role === 'engineer' || user?.role === 'inspector';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Inspection pages">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'history'}
            onClick={() => setTab('history')}
            className={`rounded-xl px-4 py-2 text-xs font-semibold transition-colors ${
              tab === 'history' ? 'bg-[#1E3A5F] text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            Past Inspections ({inspections.length})
          </button>
          {canSubmit && (
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'submit'}
              onClick={() => setTab('submit')}
              className={`rounded-xl px-4 py-2 text-xs font-semibold transition-colors ${
                tab === 'submit' ? 'bg-[#1E3A5F] text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              New Inspection
            </button>
          )}
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'faults'}
            onClick={() => setTab('faults')}
            className={`rounded-xl px-4 py-2 text-xs font-semibold transition-colors ${
              tab === 'faults' ? 'bg-[#1E3A5F] text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            Reported Problems ({faults.length})
          </button>
        </div>

        {tab === 'history' && (
          <select
            aria-label="Filter inspections by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800"
          >
            <option value="">All Statuses</option>
            <option value="Waiting for Review">Waiting for Review</option>
            <option value="Approved">Approved</option>
            <option value="Needs Follow-up">Needs Follow-up</option>
          </select>
        )}
      </div>

      {/* AI Results Panel */}
      {aiResult && (
        <section aria-label="AI Inspection Results" className="rounded-2xl border border-violet-200 bg-white p-5 space-y-4 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Bot className="h-4 w-4 text-[#7C3AED]" aria-hidden="true" />
              <h2 className="text-sm font-bold text-[#1E3A5F]">{aiResult.label}</h2>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-violet-50 border border-violet-200 px-2.5 py-0.5 text-[11px] font-semibold text-violet-700">
                AI Confidence: {aiResult.ai_confidence}
              </span>
              <StatusBadge value={aiResult.suggested_priority} />
              <button type="button" onClick={() => setAiResult(null)} aria-label="Close AI check" className="rounded p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          <p className="text-xs text-slate-700">{aiResult.summary}</p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
              <h3 className="font-bold text-emerald-800 mb-1">Observations</h3>
              <ul className="list-disc pl-4 space-y-1 text-slate-700">
                {aiResult.clearly_identifiable_observations.map((o, i) => <li key={i}>{o}</li>)}
              </ul>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
              <h3 className="font-bold text-amber-800 mb-1">Possible Fault Category</h3>
              <p className="font-semibold text-slate-800 mb-1">{aiResult.suggested_category}</p>
              <ul className="list-disc pl-4 space-y-1 text-slate-700">
                {aiResult.possible_defects_requiring_verification.map((o, i) => <li key={i}>{o}</li>)}
              </ul>
            </div>
            <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-3">
              <h3 className="font-bold text-sky-800 mb-1">Image Evidence &amp; Limits</h3>
              <p className="text-slate-700 mb-1">{aiResult.image_evidence}</p>
              <ul className="list-disc pl-4 space-y-1 text-slate-600">
                {aiResult.uncertain_or_inconclusive.map((o, i) => <li key={i}>{o}</li>)}
              </ul>
            </div>
            <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3">
              <h3 className="font-bold text-violet-800 mb-1">Suggested Next Steps</h3>
              <ul className="list-disc pl-4 space-y-1 text-slate-700">
                {aiResult.recommended_follow_up_actions.map((o, i) => <li key={i}>{o}</li>)}
              </ul>
            </div>
          </div>

          <p className="text-[11px] text-slate-600 rounded-xl bg-[#F4F7FB] p-3">
            <strong>Human Verification Status:</strong> Waiting for review by an authorised person. {aiResult.disclaimer}
          </p>

          {tab === 'submit' && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-slate-100 pt-3">
              <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                <input type="checkbox" checked={humanAck} onChange={(e) => setHumanAck(e.target.checked)} className="h-4 w-4 rounded" />
                I understand AI suggestions are not a final engineering diagnosis and must be reviewed.
              </label>
              <button
                type="button"
                disabled={!humanAck}
                onClick={applyAiSuggestion}
                className="rounded-xl bg-[#7C3AED] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-40"
              >
                Use Suggested Problem Details
              </button>
            </div>
          )}
        </section>
      )}

      {/* Submit Inspection */}
      {tab === 'submit' && canSubmit && (
        <form onSubmit={(e) => void handleSubmitInspection(e)} className="rounded-2xl border border-slate-200/80 bg-white p-6 space-y-5 shadow-xs">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-base font-bold text-[#1E3A5F]">Record a New Inspection</h2>
            <p className="text-xs text-slate-500 mt-0.5">Pick an asset, upload clear photos, write what you see, and save the report.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="insp-asset" className="block text-xs font-semibold text-slate-700">1. Choose Railway Asset</label>
              <select id="insp-asset" required value={assetId} onChange={(e) => setAssetId(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
                {assets.map((a) => <option key={a.id} value={String(a.id)}>{a.asset_code} — {a.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="insp-date" className="block text-xs font-semibold text-slate-700">2. Check Date</label>
              <input id="insp-date" type="date" required value={inspectionDate} onChange={(e) => setInspectionDate(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="insp-cat" className="block text-xs font-semibold text-slate-700">3. Inspection Type</label>
              <select id="insp-cat" value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
                {CHECK_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="insp-obs" className="block text-xs font-semibold text-slate-700">4. What did you see?</label>
              <button
                type="button"
                disabled={aiLoading}
                onClick={() => void runAiCheck()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50"
              >
                <Bot className="h-3.5 w-3.5" aria-hidden="true" />
                {aiLoading ? 'Checking...' : 'Check with AI Helper'}
              </button>
            </div>
            <textarea
              id="insp-obs"
              required
              rows={4}
              value={observed}
              onChange={(e) => setObserved(e.target.value)}
              placeholder="Write simple notes about the track, bridge, signal, or equipment condition..."
              className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <span className="block text-xs font-semibold text-slate-700 mb-1.5">5. Upload Photos (JPG, PNG, WebP · up to 5 MB each)</span>
            <label className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-[#F4F7FB] px-4 py-5 cursor-pointer hover:border-[#2563EB] hover:bg-sky-50/40">
              <Upload className="h-5 w-5 text-sky-600 mb-1.5" aria-hidden="true" />
              <span className="text-xs font-medium text-slate-700">Click here to pick inspection photos</span>
              <input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(e) => handleFilePick(e.target.files)} className="sr-only" />
            </label>

            {files.length > 0 && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-3">
                {files.map((item, idx) => (
                  <div key={idx} className="relative rounded-xl border border-slate-200 p-1.5 bg-white">
                    <img src={item.preview} alt={`Preview ${item.file.name}`} className="h-24 w-full object-cover rounded-lg" />
                    <p className="mt-1 truncate text-[10px] text-slate-600">{item.file.name}</p>
                    <button type="button" onClick={() => removeFile(idx)} aria-label={`Remove ${item.file.name}`} className="absolute -right-2 -top-2 rounded-full bg-white border border-slate-300 p-0.5 text-slate-600 shadow hover:text-rose-700">
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-[#F4F7FB] p-4 space-y-3">
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-900">
              <input type="checkbox" checked={reportFault} onChange={(e) => setReportFault(e.target.checked)} className="h-4 w-4 rounded" />
              Report a problem found during this inspection
            </label>

            {reportFault && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                <div>
                  <label htmlFor="flt-title" className="block text-xs font-semibold text-slate-700">Problem Title</label>
                  <input id="flt-title" type="text" required={reportFault} value={faultTitle} onChange={(e) => setFaultTitle(e.target.value)} placeholder="e.g. Loose track clips" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
                </div>
                <div>
                  <label htmlFor="flt-cat" className="block text-xs font-semibold text-slate-700">Problem Type</label>
                  <input id="flt-cat" type="text" value={faultCategory} onChange={(e) => setFaultCategory(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
                </div>
                <div>
                  <label htmlFor="flt-sev" className="block text-xs font-semibold text-slate-700">Priority</label>
                  <select id="flt-sev" value={faultSeverity} onChange={(e) => setFaultSeverity(e.target.value as 'Low' | 'Medium' | 'High' | 'Critical')} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Critical">Critical</option>
                  </select>
                </div>
                <div className="md:col-span-3">
                  <label htmlFor="flt-desc" className="block text-xs font-semibold text-slate-700">More Details</label>
                  <textarea id="flt-desc" rows={2} value={faultDesc} onChange={(e) => setFaultDesc(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-start">
            <button type="submit" disabled={submitting} className="rounded-xl bg-[#1E3A5F] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#284B78] disabled:opacity-60">
              {submitting ? 'Saving Inspection...' : 'Save Inspection Report'}
            </button>
          </div>
        </form>
      )}

      {/* History */}
      {tab === 'history' && (
        loading ? (
          <CardSkeleton rows={5} />
        ) : inspections.length === 0 ? (
          <EmptyState
            icon={<ClipboardCheck className="h-5 w-5" aria-hidden="true" />}
            title="No inspections recorded yet"
            description="Create a new inspection to start tracking asset checks and photos."
          />
        ) : (
          <div className="space-y-3">
            {inspections.map((ins) => (
              <article key={ins.id} className="rounded-2xl border border-slate-200/80 bg-white p-5 space-y-3 shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-xs font-bold text-[#1E3A5F]">{ins.inspection_code}</code>
                    <ProvenanceBadge isDemo={ins.is_demo} />
                    <span className="text-xs font-semibold text-slate-900">{ins.asset_code} — {ins.asset_name}</span>
                    <span className="text-xs text-slate-500">({ins.inspection_category})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge value={ins.status} />
                    <button
                      type="button"
                      onClick={() => void analyzeExistingInspection(ins)}
                      className="inline-flex items-center gap-1 rounded-xl border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-100"
                    >
                      <Bot className="h-3.5 w-3.5" aria-hidden="true" />
                      AI Check
                    </button>
                    {canReview && ins.status === 'Waiting for Review' && (
                      <button
                        type="button"
                        onClick={() => {
                          setReviewTarget(ins);
                          setReviewNotes('');
                        }}
                        className="rounded-xl bg-[#1E3A5F] px-3 py-1 text-xs font-semibold text-white hover:bg-[#284B78]"
                      >
                        Review
                      </button>
                    )}
                  </div>
                </div>

                <p className="text-sm text-slate-800">{ins.observed_conditions}</p>

                {ins.images && ins.images.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {ins.images.map((img) => (
                      <div key={img.id} className="flex flex-col gap-1">
                        <AuthInspectionImage storedFilename={img.stored_filename} alt={img.original_filename} />
                        <span className="text-[10px] text-slate-500 flex items-center gap-1 truncate max-w-24">
                          <FileImage className="h-3 w-3 shrink-0" aria-hidden="true" />
                          {img.original_filename}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-xs text-slate-500">
                  <span>Checked by <strong className="text-slate-700">{ins.inspector_name}</strong> on {ins.inspection_date}</span>
                  {ins.reviewer_name && (
                    <span>Reviewed by <strong className="text-slate-700">{ins.reviewer_name}</strong>{ins.review_notes ? ` — "${ins.review_notes}"` : ''}</span>
                  )}
                </div>
              </article>
            ))}
          </div>
        )
      )}

      {/* Fault Reports */}
      {tab === 'faults' && (
        loading ? (
          <CardSkeleton rows={5} />
        ) : faults.length === 0 ? (
          <EmptyState
            icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
            title="No problems reported yet"
            description="Problems reported during inspections appear here for human verification."
          />
        ) : (
          <div className="space-y-3">
            {faults.map((f) => (
              <article key={f.id} className="rounded-2xl border border-slate-200/80 bg-white p-5 space-y-2.5 shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-xs font-bold text-[#1E3A5F]">{f.fault_code}</code>
                    <ProvenanceBadge isDemo={f.is_demo} />
                    <span className="text-sm font-bold text-slate-900">{f.title}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge value={f.severity} />
                    <StatusBadge value={f.status} />
                  </div>
                </div>
                <p className="text-xs text-slate-700">{f.description}</p>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-xs text-slate-500">
                  <span>Asset: <strong className="text-slate-800">{f.asset_code}</strong> · Type: {f.category}</span>
                  <div className="flex items-center gap-2">
                    {f.human_verified ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Confirmed by {f.verifier_name || 'Reviewer'}
                      </span>
                    ) : (
                      <>
                        <span className="inline-flex items-center gap-1 text-amber-700 font-semibold">
                          <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                          Needs Human Review
                        </span>
                        {canReview && (
                          <button type="button" onClick={() => void handleVerifyFault(f)} className="rounded-xl bg-[#1E3A5F] px-3 py-1 text-xs font-semibold text-white hover:bg-[#284B78]">
                            Confirm Finding
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )
      )}

      {/* Review Modal */}
      {reviewTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-label="Review Inspection">
          <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between bg-[#1E3A5F] px-5 py-4 text-white">
              <h2 className="text-sm font-bold">Review {reviewTarget.inspection_code}</h2>
              <button type="button" onClick={() => setReviewTarget(null)} aria-label="Close" className="rounded p-1 hover:bg-white/10">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-xs text-slate-700"><strong>{reviewTarget.asset_code}</strong> — {reviewTarget.observed_conditions}</p>
              <div>
                <label htmlFor="rev-notes" className="block text-xs font-semibold text-slate-700">Review Notes</label>
                <textarea id="rev-notes" rows={3} value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} placeholder="Add your comments here..." className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => void handleReviewSubmit('Needs Follow-up')} className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100">
                  Needs Follow-up
                </button>
                <button type="button" onClick={() => void handleReviewSubmit('Approved')} className="rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700">
                  Approve
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
