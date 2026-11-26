import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bot, Send, Sparkles, X } from 'lucide-react';
import { api } from '../lib/api';

interface ChatMessage {
  id: number;
  sender: 'raily' | 'user';
  text: string;
  mode?: string;
  limitation?: string;
  links?: { label: string; path: string }[];
}

function RailyAvatar({ waving }: { waving: boolean }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className="h-10 w-10 raily-idle shrink-0"
      role="img"
      aria-label="Raily railway helper character"
    >
      <defs>
        <linearGradient id="railyBodySoft" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="100%" stopColor="#1E3A5F" />
        </linearGradient>
      </defs>
      <line x1="32" y1="6" x2="32" y2="14" stroke="#93C5FD" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="32" cy="5.5" r="3.5" fill="#10B981" />
      <rect x="18" y="13" width="28" height="7" rx="3.5" fill="#1E3A5F" />
      <rect x="15" y="18" width="34" height="3" rx="1.5" fill="#FBBF24" />
      <rect x="16" y="21" width="32" height="22" rx="8" fill="url(#railyBodySoft)" stroke="#C4B5FD" strokeWidth="1.5" />
      <rect x="20" y="25" width="24" height="12" rx="5" fill="#0F172A" />
      <circle cx="27" cy="31" r="2.7" fill="#7DD3FC" />
      <circle cx="37" cy="31" r="2.7" fill="#7DD3FC" />
      <path d="M28 34.5 Q32 37 36 34.5" stroke="#A5F3FC" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <rect x="21" y="44" width="22" height="11" rx="5" fill="#7C3AED" />
      <rect x="27" y="47" width="10" height="4" rx="2" fill="#EDE9FE" />
      <rect x="11" y="44" width="6" height="10" rx="3" fill="#2563EB" />
      <g className={waving ? 'raily-arm-wave' : ''}>
        <rect x="47" y="34" width="6" height="12" rx="3" fill="#60A5FA" />
        <circle cx="50" cy="33" r="3" fill="#DDD6FE" />
      </g>
    </svg>
  );
}

const QUICK_PROMPTS = [
  'Give me a project summary',
  'How do inspections work?',
  'Explain maintenance task steps',
  'Where can I find the map?',
];

export function RailyAssistant() {
  const [open, setOpen] = useState(false);
  const [showBubble, setShowBubble] = useState(true);
  const [waving, setWaving] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      sender: 'raily',
      text: 'Hi! I am Raily, your friendly railway helper. I can explain pages, summarize your live records, and help you find inspections, tasks, or reports.',
      limitation: 'Raily uses connected AI when available, or Guided Help from your saved database records.',
    },
  ]);

  const location = useLocation();
  const navigate = useNavigate();

  const sendMessage = async (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed || sending) return;

    const userMsg: ChatMessage = { id: Date.now(), sender: 'user', text: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);
    setWaving(true);

    try {
      const res = await api.post<{
        reply: string;
        mode: string;
        ai_available: boolean;
        suggested_links: { label: string; path: string }[];
        limitation_note: string;
      }>('/api/assistant/chat', {
        message: trimmed,
        current_route: location.pathname,
      });

      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          sender: 'raily',
          text: res.reply,
          mode: res.mode,
          links: res.suggested_links,
          limitation: res.limitation_note,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          sender: 'raily',
          text: 'Sorry, I could not connect to the assistant right now. Please check your connection and try again.',
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2 no-print">
      {!open && showBubble && (
        <div className="flex items-center gap-2 rounded-2xl border border-violet-200 bg-white px-3.5 py-2 shadow-md max-w-xs">
          <p className="text-xs text-slate-700">
            <span className="font-semibold text-[#1E3A5F]">Raily:</span> Need help finding something or checking today&apos;s data?
          </p>
          <button
            type="button"
            onClick={() => setShowBubble(false)}
            aria-label="Hide Raily message"
            className="rounded p-0.5 text-slate-400 hover:text-slate-700"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {open && (
        <section
          aria-label="Raily Helper Panel"
          className="w-[calc(100vw-2rem)] sm:w-96 rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden flex flex-col max-h-[75vh]"
        >
          <div className="flex items-center justify-between bg-[#1E3A5F] px-4 py-3 text-white">
            <div className="flex items-center gap-2.5">
              <RailyAvatar waving={waving} />
              <div>
                <h2 className="text-sm font-semibold leading-tight flex items-center gap-1.5">
                  Raily Helper
                  <Sparkles className="h-3.5 w-3.5 text-violet-200" aria-hidden="true" />
                </h2>
                <p className="text-[11px] text-sky-100">Simple Railway Guide</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close Raily"
              className="rounded-lg p-1.5 text-sky-100 hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3.5 space-y-3 bg-[#F4F7FB]">
            {messages.map((m) => (
              <div key={m.id} className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}>
                <div
                  className={`rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed max-w-[88%] ${
                    m.sender === 'user'
                      ? 'bg-[#2563EB] text-white'
                      : 'bg-white border border-slate-200/80 text-slate-800 shadow-xs'
                  }`}
                >
                  <p>{m.text}</p>
                  {m.links && m.links.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.links.map((lnk) => (
                        <button
                          key={lnk.path}
                          type="button"
                          onClick={() => navigate(lnk.path)}
                          className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700 hover:bg-sky-100"
                        >
                          {lnk.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {m.limitation && (
                    <p className="mt-2 border-t border-slate-100 pt-1.5 text-[10px] text-slate-500">
                      {m.limitation}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-slate-100 bg-white px-3 pt-2 pb-1 flex flex-wrap gap-1.5">
            {QUICK_PROMPTS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => void sendMessage(q)}
                className="rounded-full border border-violet-200 bg-violet-50/70 px-2.5 py-1 text-[11px] font-medium text-violet-800 hover:bg-violet-100"
              >
                {q}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendMessage(input);
            }}
            className="flex items-center gap-2 border-t border-slate-200 bg-white p-3"
          >
            <label htmlFor="raily-input" className="sr-only">
              Ask Raily a question
            </label>
            <input
              id="raily-input"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Raily a simple question..."
              className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#2563EB] focus:outline-none"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              aria-label="Send message to Raily"
              className="inline-flex items-center justify-center rounded-xl bg-[#1E3A5F] p-2 text-white hover:bg-[#284B78] disabled:opacity-50"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </button>
          </form>
        </section>
      )}

      <button
        type="button"
        onClick={() => {
          setOpen((prev) => !prev);
          setShowBubble(false);
          setWaving(false);
        }}
        onMouseEnter={() => setWaving(true)}
        aria-expanded={open}
        aria-label="Open Raily Railway Assistant"
        className="flex items-center gap-2 rounded-full border border-violet-200 bg-[#1E3A5F] px-3.5 py-2 text-white shadow-lg hover:bg-[#284B78] transition-colors"
      >
        <RailyAvatar waving={waving} />
        <span className="text-xs font-semibold pr-1 hidden sm:inline">Ask Raily</span>
        <Bot className="h-4 w-4 text-sky-200 sm:hidden" aria-hidden="true" />
      </button>
    </div>
  );
}
