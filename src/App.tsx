import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Copy,
  Check,
  ClipboardPaste,
  Plus,
  Search,
  Pin,
  Trash2,
  Download,
  Users,
  Sparkles,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  RefreshCw,
  User,
  FileText,
  AlignLeft,
} from 'lucide-react';
import type { SharedClip, ConnectedUser, ClipCategory, ServerEvent, ClientEvent } from './types';

const CATEGORY_LABELS: Record<ClipCategory, string> = {
  umum: 'Umum',
  kode: 'Kode & Teknis',
  tautan: 'Tautan & Catatan',
};

type FilterTab = 'semua' | 'umum' | 'kode' | 'tautan' | 'disematkan';
type SortMode = 'terbaru' | 'populer';

function getOrCreateClientIdentity(): { clientId: string; defaultName: string } {
  try {
    const savedId = localStorage.getItem('tempelsalin_client_id');
    const savedName = localStorage.getItem('tempelsalin_user_name');
    const clientId =
      savedId || `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const defaultName =
      savedName || `Pengguna #${Math.floor(100 + Math.random() * 900)}`;
    if (!savedId) localStorage.setItem('tempelsalin_client_id', clientId);
    if (!savedName) localStorage.setItem('tempelsalin_user_name', defaultName);
    return { clientId, defaultName };
  } catch {
    return {
      clientId: `client-${Math.random().toString(36).slice(2, 8)}`,
      defaultName: `Pengguna #${Math.floor(100 + Math.random() * 900)}`,
    };
  }
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback for iframe clipboard restrictions
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

function formatRelativeTime(timestamp: number, now: number): string {
  const diffSec = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (diffSec < 10) return 'Baru saja';
  if (diffSec < 60) return `${diffSec} dtk lalu`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} mnt lalu`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} jam lalu`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} hari lalu`;
}

function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0] : null;
}

export default function App() {
  const identity = useMemo(() => getOrCreateClientIdentity(), []);
  const [userName, setUserName] = useState<string>(identity.defaultName);
  const [isEditingName, setIsEditingName] = useState(false);

  // Real-time synced state
  const [clips, setClips] = useState<SharedClip[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<ConnectedUser[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isConnected, setIsConnected] = useState<boolean>(false);

  // Composer state
  const [content, setContent] = useState<string>('');
  const [title, setTitle] = useState<string>('');
  const [category, setCategory] = useState<ClipCategory>('umum');
  const [composerFeedback, setComposerFeedback] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Filter & view state
  const [activeTab, setActiveTab] = useState<FilterTab>('semua');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortMode, setSortMode] = useState<SortMode>('terbaru');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [nowTick, setNowTick] = useState<number>(Date.now());

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);

  // Update relative timestamps every 15s
  useEffect(() => {
    const interval = window.setInterval(() => setNowTick(Date.now()), 15000);
    return () => window.clearInterval(interval);
  }, []);

  // Idempotent state helpers
  const upsertClip = useCallback((incomingClip: SharedClip) => {
    setClips((prev) => {
      const exists = prev.some((c) => c.id === incomingClip.id);
      if (exists) {
        return prev.map((c) => (c.id === incomingClip.id ? incomingClip : c));
      }
      return [incomingClip, ...prev];
    });
  }, []);

  const removeClipLocal = useCallback((id: string) => {
    setClips((prev) => prev.filter((c) => c.id !== id));
  }, []);

  // Fetch initial state via HTTP as reliable baseline
  const fetchClipsFromServer = useCallback(async () => {
    try {
      const res = await fetch('/api/clips');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.clips)) {
        setClips(data.clips);
      }
      if (Array.isArray(data.users)) {
        setOnlineUsers(data.users);
      }
    } catch {
      // Handled by WebSocket reconnect
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Send WebSocket event helper
  const sendWsEvent = useCallback((event: ClientEvent): boolean => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(event));
      return true;
    }
    return false;
  }, []);

  // Set up WebSocket + BroadcastChannel for real-time updates
  useEffect(() => {
    fetchClipsFromServer();

    if ('BroadcastChannel' in window) {
      const bc = new BroadcastChannel('tempelsalin_realtime_sync');
      bc.onmessage = (ev) => {
        const msg = ev.data as ServerEvent;
        if (!msg || !msg.type) return;
        if (msg.type === 'clip:created' || msg.type === 'clip:updated') {
          upsertClip(msg.clip);
        } else if (msg.type === 'clip:deleted') {
          removeClipLocal(msg.id);
        }
      };
      broadcastChannelRef.current = bc;
    }

    let isUnmounted = false;

    function connectWebSocket() {
      if (isUnmounted) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isUnmounted) return;
        setIsConnected(true);
        setIsLoading(false);
        ws.send(
          JSON.stringify({
            type: 'user:identify',
            clientId: identity.clientId,
            name: localStorage.getItem('tempelsalin_user_name') || identity.defaultName,
          } satisfies ClientEvent)
        );
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as ServerEvent;
          switch (data.type) {
            case 'init':
              setClips(data.clips);
              setOnlineUsers(data.users);
              setIsLoading(false);
              break;
            case 'clip:created':
            case 'clip:updated':
              upsertClip(data.clip);
              break;
            case 'clip:deleted':
              removeClipLocal(data.id);
              break;
            case 'presence:updated':
              setOnlineUsers(data.users);
              break;
          }
        } catch (e) {
          console.error('Failed to parse realtime message:', e);
        }
      };

      ws.onclose = () => {
        if (isUnmounted) return;
        setIsConnected(false);
        reconnectTimeoutRef.current = window.setTimeout(() => {
          connectWebSocket();
        }, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connectWebSocket();

    return () => {
      isUnmounted = true;
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.close();
      }
    };
  }, [fetchClipsFromServer, identity.clientId, identity.defaultName, removeClipLocal, upsertClip]);

  // Save user name changes and broadcast identity
  const handleSaveUserName = (newName: string) => {
    const cleaned = newName.trim() || identity.defaultName;
    setUserName(cleaned);
    setIsEditingName(false);
    try {
      localStorage.setItem('tempelsalin_user_name', cleaned);
    } catch {
      // Ignore storage error
    }
    sendWsEvent({
      type: 'user:identify',
      clientId: identity.clientId,
      name: cleaned,
    });
  };

  // Notify typing/pasting state to other connected users
  const handleContentChange = (value: string) => {
    setContent(value);
    sendWsEvent({
      type: 'user:typing',
      clientId: identity.clientId,
      isTyping: value.trim().length > 0,
    });
    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = window.setTimeout(() => {
      sendWsEvent({
        type: 'user:typing',
        clientId: identity.clientId,
        isTyping: false,
      });
    }, 2500);
  };

  // Read from system clipboard into composer
  const handlePasteFromClipboard = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const clipText = await navigator.clipboard.readText();
        if (clipText) {
          handleContentChange(content ? `${content}\n${clipText}` : clipText);
          setComposerFeedback('Teks berhasil ditempel dari clipboard.');
          setTimeout(() => setComposerFeedback(null), 2500);
          textareaRef.current?.focus();
          return;
        }
      }
    } catch {
      // Browser blocked programmatic readText inside iframe
    }
    textareaRef.current?.focus();
    setComposerFeedback('Tekan Ctrl+V (atau Cmd+V) langsung di kotak teks untuk menempel.');
    setTimeout(() => setComposerFeedback(null), 3500);
  };

  // Submit new clip ("Tambahkan")
  const handleAddClip = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || isSubmitting) return;

    setIsSubmitting(true);
    const clipId = `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const firstLine = trimmed.split('\n')[0].trim().slice(0, 65);
    const finalTitle = title.trim() || firstLine || 'Teks Tanpa Judul';
    const now = Date.now();

    const optimisticClip: SharedClip = {
      id: clipId,
      title: finalTitle,
      content: trimmed,
      author: userName.trim() || identity.defaultName,
      authorId: identity.clientId,
      category,
      pinned: false,
      copyCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    // Optimistic update immediately
    upsertClip(optimisticClip);
    broadcastChannelRef.current?.postMessage({ type: 'clip:created', clip: optimisticClip });

    setContent('');
    setTitle('');
    setComposerFeedback('Teks berhasil ditambahkan dan dibagikan secara real-time!');
    setTimeout(() => setComposerFeedback(null), 2500);

    try {
      const res = await fetch('/api/clips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: clipId,
          title: finalTitle,
          content: trimmed,
          author: optimisticClip.author,
          authorId: identity.clientId,
          category,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.clip) upsertClip(data.clip);
      } else {
        // Fallback to WS if HTTP failed
        sendWsEvent({
          type: 'clip:create',
          id: clipId,
          title: finalTitle,
          content: trimmed,
          author: optimisticClip.author,
          authorId: identity.clientId,
          category,
        });
      }
    } catch {
      sendWsEvent({
        type: 'clip:create',
        id: clipId,
        title: finalTitle,
        content: trimmed,
        author: optimisticClip.author,
        authorId: identity.clientId,
        category,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Copy clip content ("Salin")
  const handleCopyClip = async (clip: SharedClip) => {
    const ok = await copyTextToClipboard(clip.content);
    if (ok) {
      setCopiedId(clip.id);
      setTimeout(() => {
        setCopiedId((prev) => (prev === clip.id ? null : prev));
      }, 2000);

      // Optimistic increment
      const updated = { ...clip, copyCount: clip.copyCount + 1, updatedAt: Date.now() };
      upsertClip(updated);
      broadcastChannelRef.current?.postMessage({ type: 'clip:updated', clip: updated });

      if (!sendWsEvent({ type: 'clip:copy', id: clip.id })) {
        fetch(`/api/clips/${encodeURIComponent(clip.id)}/copy`, { method: 'POST' }).catch(() => {});
      }
    }
  };

  // Toggle Pin
  const handleTogglePin = async (clip: SharedClip) => {
    const updated = { ...clip, pinned: !clip.pinned, updatedAt: Date.now() };
    upsertClip(updated);
    broadcastChannelRef.current?.postMessage({ type: 'clip:updated', clip: updated });

    if (!sendWsEvent({ type: 'clip:pin', id: clip.id })) {
      fetch(`/api/clips/${encodeURIComponent(clip.id)}/pin`, { method: 'PATCH' }).catch(() => {});
    }
  };

  // Delete Clip
  const handleDeleteClip = async (id: string) => {
    removeClipLocal(id);
    broadcastChannelRef.current?.postMessage({ type: 'clip:deleted', id });

    if (!sendWsEvent({ type: 'clip:delete', id })) {
      fetch(`/api/clips/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
    }
  };

  // Download as .txt file
  const handleDownloadClip = (clip: SharedClip) => {
    const blob = new Blob([clip.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeFilename = clip.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    a.href = url;
    a.download = `${safeFilename || 'teks-shared'}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Filtered and sorted clips
  const filteredClips = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return clips
      .filter((clip) => {
        if (activeTab === 'disematkan' && !clip.pinned) return false;
        if (activeTab === 'umum' && clip.category !== 'umum') return false;
        if (activeTab === 'kode' && clip.category !== 'kode') return false;
        if (activeTab === 'tautan' && clip.category !== 'tautan') return false;
        if (!q) return true;
        return (
          clip.content.toLowerCase().includes(q) ||
          clip.title.toLowerCase().includes(q) ||
          clip.author.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (sortMode === 'populer') {
          if (b.copyCount !== a.copyCount) return b.copyCount - a.copyCount;
        }
        return b.createdAt - a.createdAt;
      });
  }, [clips, activeTab, searchQuery, sortMode]);

  const otherTypingUsers = useMemo(
    () => onlineUsers.filter((u) => u.isTyping && u.clientId !== identity.clientId),
    [onlineUsers, identity.clientId]
  );

  const charCount = content.length;
  const lineCount = content ? content.split('\n').length : 0;

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-slate-900">
      {/* Top Bar Contract: Zone 1 (Brand) — Zone 2 (Nav Links) — Zone 3 (Primary Actions) */}
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200 px-4 sm:px-8 py-3.5">
        <div className="max-w-[1200px] mx-auto flex items-center justify-between gap-4">
          {/* Zone 1: Single text element wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('semua');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            TempelSalin
          </a>

          {/* Zone 2: 5 clean text navigation links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            {(
              [
                { id: 'semua', label: 'Semua Teks' },
                { id: 'umum', label: 'Umum' },
                { id: 'kode', label: 'Kode & Teknis' },
                { id: 'tautan', label: 'Tautan' },
                { id: 'disematkan', label: 'Disematkan' },
              ] as { id: FilterTab; label: string }[]
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                  activeTab === item.id
                    ? 'border-blue-600 text-slate-900 font-semibold'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Zone 3: 1-2 Primary Actions */}
          <div className="flex items-center gap-3">
            {isEditingName ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSaveUserName(userName);
                }}
                className="flex items-center gap-1.5"
              >
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  onBlur={() => handleSaveUserName(userName)}
                  maxLength={32}
                  autoFocus
                  aria-label="Nama tampilan Anda"
                  className="px-2.5 py-1.5 text-xs font-medium bg-slate-50 border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 w-36"
                />
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setIsEditingName(true)}
                title="Klik untuk mengubah nama pengirim"
                className="px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200/80 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <User className="w-3.5 h-3.5 text-slate-500" />
                <span className="truncate max-w-[120px]">{userName}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                textareaRef.current?.focus();
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tempel Teks</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace Container (1200px max width, structured 12-column grid on desktop) */}
      <main className="flex-1 max-w-[1200px] w-full mx-auto px-4 sm:px-8 py-6 sm:py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left / Top Column: Composer & Live Presence (5 cols on desktop) */}
          <section className="lg:col-span-5 lg:sticky lg:top-20 space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6">
              <div className="flex items-center justify-between gap-2 mb-4">
                <div>
                  <h1 className="text-lg font-bold text-slate-900 tracking-tight">
                    Tempel & Bagikan Teks
                  </h1>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Teks yang Anda tambahkan langsung tampil ke semua pengguna secara real-time.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handlePasteFromClipboard}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  title="Tempel langsung dari clipboard perangkat Anda"
                >
                  <ClipboardPaste className="w-3.5 h-3.5 text-blue-600" />
                  <span>Tempel Clipboard</span>
                </button>
              </div>

              <form onSubmit={handleAddClip} className="space-y-3.5">
                {/* Optional Title Input */}
                <div>
                  <label htmlFor="clip-title" className="block text-xs font-medium text-slate-700 mb-1">
                    Judul / Keterangan <span className="text-slate-400 font-normal">(opsional)</span>
                  </label>
                  <input
                    id="clip-title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Contoh: Link Zoom Rapat, Snippet Config, Catatan..."
                    maxLength={120}
                    className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all"
                  />
                </div>

                {/* Main Copy-Paste Textarea */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor="clip-content" className="block text-xs font-medium text-slate-700">
                      Isi Teks
                    </label>
                    <span className="text-xs text-slate-400 font-mono tabular-nums">
                      {charCount.toLocaleString('id-ID')} karakter · {lineCount} baris
                    </span>
                  </div>
                  <textarea
                    id="clip-content"
                    ref={textareaRef}
                    rows={7}
                    value={content}
                    onChange={(e) => handleContentChange(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        handleAddClip();
                      }
                    }}
                    placeholder="Tempel (Ctrl+V / Klik Kanan -> Paste) atau ketik teks di sini..."
                    className="w-full p-3.5 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all resize-y leading-relaxed"
                    required
                  />
                </div>

                {/* Category Selector (Interactive Segmented Buttons) */}
                <div>
                  <span className="block text-xs font-medium text-slate-700 mb-1.5">
                    Kategori Teks
                  </span>
                  <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-lg">
                    {(['umum', 'kode', 'tautan'] as ClipCategory[]).map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setCategory(cat)}
                        className={`py-1.5 px-2.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap truncate cursor-pointer ${
                          category === cat
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {CATEGORY_LABELS[cat]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Feedback message if any */}
                {composerFeedback && (
                  <p className="text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                    {composerFeedback}
                  </p>
                )}

                {/* Primary Submit Button ("Tambahkan") */}
                <div className="pt-1 flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={!content.trim() || isSubmitting}
                    className="flex-1 py-2.5 px-4 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer disabled:cursor-not-allowed"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Tambahkan</span>
                  </button>
                  {content && (
                    <button
                      type="button"
                      onClick={() => {
                        setContent('');
                        setTitle('');
                      }}
                      className="py-2.5 px-3 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                    >
                      Bersihkan
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 text-center">
                  Pintasan: Tekan <kbd className="font-mono text-slate-600">Ctrl + Enter</kbd> untuk langsung menambahkan teks
                </p>
              </form>
            </div>

            {/* Active Users & Real-Time Sync Info */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 font-semibold text-slate-800">
                  <Users className="w-4 h-4 text-slate-500" />
                  <span>Pengguna Terhubung Real-Time</span>
                </div>
                <span className="font-mono tabular-nums text-slate-600">
                  {Math.max(1, onlineUsers.length)} aktif ·{' '}
                  {isConnected ? 'Sinkronisasi Aktif' : 'Menyambungkan...'}
                </span>
              </div>

              <div className="text-xs text-slate-600 leading-relaxed flex flex-wrap items-center gap-x-2 gap-y-1">
                {onlineUsers.length === 0 ? (
                  <span>{userName} (Anda)</span>
                ) : (
                  onlineUsers.map((u, idx) => (
                    <React.Fragment key={u.clientId}>
                      {idx > 0 && <span aria-hidden="true">·</span>}
                      <span
                        className={
                          u.clientId === identity.clientId
                            ? 'font-semibold text-slate-900'
                            : 'text-slate-600'
                        }
                      >
                        {u.name}
                        {u.clientId === identity.clientId ? ' (Anda)' : ''}
                      </span>
                    </React.Fragment>
                  ))
                )}
              </div>

              {otherTypingUsers.length > 0 && (
                <p className="text-xs text-blue-600 font-medium pt-1 border-t border-slate-100">
                  {otherTypingUsers.map((u) => u.name).join(', ')} sedang mengetik / menyiapkan teks...
                </p>
              )}
            </div>
          </section>

          {/* Right / Main Column: Real-Time Shared Text Feed (7 cols on desktop) */}
          <section className="lg:col-span-7 space-y-4">
            {/* Search & Filter Control Bar */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                {/* Search Input */}
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cari isi teks, judul, atau nama pengirim..."
                    aria-label="Cari teks yang ditempel"
                    className="w-full pl-9 pr-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                  />
                </div>

                {/* Sort Segmented Control */}
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0">
                  <button
                    type="button"
                    onClick={() => setSortMode('terbaru')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      sortMode === 'terbaru'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Terbaru
                  </button>
                  <button
                    type="button"
                    onClick={() => setSortMode('populer')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      sortMode === 'populer'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Terbanyak Disalin
                  </button>
                  <button
                    type="button"
                    onClick={fetchClipsFromServer}
                    title="Segarkan daftar teks"
                    className="p-1.5 text-slate-600 hover:text-slate-900 rounded-md transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Mobile Filter Tabs + Summary Count */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100">
                <div className="flex md:hidden items-center gap-1 overflow-x-auto py-0.5">
                  {(
                    [
                      { id: 'semua', label: 'Semua' },
                      { id: 'umum', label: 'Umum' },
                      { id: 'kode', label: 'Kode' },
                      { id: 'tautan', label: 'Tautan' },
                      { id: 'disematkan', label: 'Disematkan' },
                    ] as { id: FilterTab; label: string }[]
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap ${
                        activeTab === tab.id
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="text-xs text-slate-500 font-mono tabular-nums">
                  Menampilkan {filteredClips.length} dari {clips.length} teks bersama
                </div>
              </div>
            </div>

            {/* Stream States: Loading, Empty, or Populated */}
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((n) => (
                  <div
                    key={n}
                    className="bg-white border border-slate-200 rounded-xl p-5 animate-pulse space-y-3"
                  >
                    <div className="h-4 bg-slate-200 rounded w-1/3" />
                    <div className="h-20 bg-slate-100 rounded w-full" />
                    <div className="h-3 bg-slate-100 rounded w-1/2" />
                  </div>
                ))}
              </div>
            ) : filteredClips.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
                <FileText className="w-8 h-8 text-slate-400 mx-auto" />
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-slate-900">
                    Belum ada teks pada tampilan ini
                  </h2>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    {searchQuery
                      ? `Tidak ditemukan teks yang cocok dengan pencarian "${searchQuery}".`
                      : 'Tempelkan teks baru pada panel di samping lalu klik tombol "Tambahkan" agar seluruh pengguna dapat melihat dan menyalinnya.'}
                  </p>
                </div>
                {(searchQuery || activeTab !== 'semua') && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setActiveTab('semua');
                    }}
                    className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                  >
                    Tampilkan Semua Teks
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3.5">
                {filteredClips.map((clip) => {
                  const isCopied = copiedId === clip.id;
                  const isExpanded = Boolean(expandedIds[clip.id]);
                  const lines = clip.content.split('\n');
                  const isLong = clip.content.length > 420 || lines.length > 8;
                  const displayContent =
                    isLong && !isExpanded
                      ? lines.slice(0, 8).join('\n').slice(0, 420) + '...'
                      : clip.content;
                  const firstUrl = extractFirstUrl(clip.content);

                  return (
                    <article
                      key={clip.id}
                      className={`bg-white border rounded-xl p-5 transition-colors ${
                        clip.pinned ? 'border-blue-300' : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {/* Card Top Row: Title + Primary Copy Button & Actions */}
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="min-w-0 flex-1">
                          <h2 className="text-base font-semibold text-slate-900 leading-snug break-words">
                            {clip.title}
                          </h2>
                          {/* Zero-Pill Metadata Discipline: Clean unboxed inline text with · separators */}
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 mt-1 tabular-nums">
                            {clip.pinned && (
                              <>
                                <span className="font-semibold text-blue-600">Disematkan</span>
                                <span aria-hidden="true">·</span>
                              </>
                            )}
                            <span className="font-medium text-slate-700">{clip.author}</span>
                            <span aria-hidden="true">·</span>
                            <span>{CATEGORY_LABELS[clip.category]}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatRelativeTime(clip.createdAt, nowTick)}</span>
                          </div>
                        </div>

                        {/* Action Bar: Primary Copy Button + Pin / Download / Delete */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleCopyClip(clip)}
                            className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                              isCopied
                                ? 'bg-emerald-600 text-white'
                                : 'bg-blue-600 hover:bg-blue-700 text-white'
                            }`}
                          >
                            {isCopied ? (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                <span>Tersalin!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>Salin Teks</span>
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleTogglePin(clip)}
                            title={clip.pinned ? 'Lepas sematan' : 'Sematkan di paling atas'}
                            className={`p-2 rounded-lg border transition-colors cursor-pointer ${
                              clip.pinned
                                ? 'bg-blue-50 border-blue-200 text-blue-600'
                                : 'bg-white border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                            }`}
                          >
                            <Pin className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDownloadClip(clip)}
                            title="Unduh sebagai file .txt"
                            className="p-2 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteClip(clip.id)}
                            title="Hapus teks ini"
                            className="p-2 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Shared Text Content Box */}
                      <div className="relative group">
                        <pre
                          onClick={() => handleCopyClip(clip)}
                          title="Klik untuk langsung menyalin teks ini"
                          className="w-full p-3.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200/80 rounded-lg text-xs sm:text-sm font-mono text-slate-800 whitespace-pre-wrap break-words overflow-x-auto leading-relaxed cursor-pointer transition-colors"
                        >
                          {displayContent}
                        </pre>
                      </div>

                      {/* Card Footer: Unboxed tabular metrics & Expand/Link actions */}
                      <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 tabular-nums">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span>{clip.content.length.toLocaleString('id-ID')} karakter</span>
                          <span aria-hidden="true">·</span>
                          <span>{lines.length} baris</span>
                          <span aria-hidden="true">·</span>
                          <span>Disalin {clip.copyCount} kali</span>
                        </div>

                        <div className="flex items-center gap-3">
                          {firstUrl && (
                            <a
                              href={firstUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 whitespace-nowrap"
                            >
                              <span>Buka Tautan</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}

                          {isLong && (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedIds((prev) => ({
                                  ...prev,
                                  [clip.id]: !isExpanded,
                                }))
                              }
                              className="text-slate-700 hover:text-slate-900 font-medium flex items-center gap-1 whitespace-nowrap cursor-pointer"
                            >
                              {isExpanded ? (
                                <>
                                  <span>Ringkas Teks</span>
                                  <ChevronUp className="w-3.5 h-3.5" />
                                </>
                              ) : (
                                <>
                                  <span>Lihat Selengkapnya ({lines.length} baris)</span>
                                  <ChevronDown className="w-3.5 h-3.5" />
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 px-4 sm:px-8 mt-12">
        <div className="max-w-[1200px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>TempelSalin — Papan Klip Bersama Real-Time</span>
          <span>Klik pada teks mana saja atau tombol "Salin Teks" untuk menyalin ke clipboard Anda.</span>
        </div>
      </footer>
    </div>
  );
}
