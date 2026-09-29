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
  ChevronDown,
  ChevronUp,
  ExternalLink,
  RefreshCw,
  User,
  FileText,
  Edit3,
  History,
  RotateCcw,
  Save,
  Eye,
  Clock,
  ArrowUpRight,
} from 'lucide-react';
import type {
  SharedClip,
  ConnectedUser,
  ClipCategory,
  ServerEvent,
  ClientEvent,
  TextHistoryEntry,
  HistoryActionType,
} from './types';

const CATEGORY_LABELS: Record<ClipCategory, string> = {
  umum: 'Umum',
  kode: 'Kode & Teknis',
  tautan: 'Tautan & Catatan',
};

const ACTION_LABELS: Record<HistoryActionType, string> = {
  ditempel: 'Ditempel (Paste)',
  disalin: 'Disalin (Copy)',
  ditambahkan: 'Ditambahkan',
  diedit: 'Versi Kolaborasi',
};

type MainViewTab = 'semua' | 'kolaborasi' | 'riwayat' | 'kode' | 'disematkan';
type HistoryFilterType = 'semua' | 'disalin' | 'ditempel' | 'diedit';
type SortMode = 'terbaru' | 'populer';

const LOCAL_HISTORY_KEY = 'tempelsalin_local_history_v1';

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

function loadLocalHistory(): TextHistoryEntry[] {
  try {
    const raw = localStorage.getItem(LOCAL_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalHistory(entries: TextHistoryEntry[]) {
  try {
    localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(entries.slice(0, 300)));
  } catch {
    // Ignore storage quota errors
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
  if (diffSec < 8) return 'Baru saja';
  if (diffSec < 60) return `${diffSec} dtk lalu`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} mnt lalu`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} jam lalu`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} hari lalu`;
}

function formatClockTime(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '';
  }
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
  const [historyEntries, setHistoryEntries] = useState<TextHistoryEntry[]>(() =>
    loadLocalHistory()
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isConnected, setIsConnected] = useState<boolean>(false);

  // Active Collaborative Editing State
  const [activeCollabClipId, setActiveCollabClipId] = useState<string | null>(null);
  const [inlineEditingClipId, setInlineEditingClipId] = useState<string | null>(null);
  const [lastLiveUpdateInfo, setLastLiveUpdateInfo] = useState<{
    clipId: string;
    editorName: string;
    timestamp: number;
  } | null>(null);
  const [showRevisionsForClipId, setShowRevisionsForClipId] = useState<string | null>(null);

  // Left-panel Mode: 'tambah' (New Paste/Clip) or 'kolaborasi' (Live Collaborative Editor)
  const [leftPanelMode, setLeftPanelMode] = useState<'tambah' | 'kolaborasi'>('tambah');

  // Composer state (for adding new clip)
  const [content, setContent] = useState<string>('');
  const [title, setTitle] = useState<string>('');
  const [category, setCategory] = useState<ClipCategory>('umum');
  const [composerFeedback, setComposerFeedback] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Navigation & filter state
  const [activeTab, setActiveTab] = useState<MainViewTab>('semua');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortMode, setSortMode] = useState<SortMode>('terbaru');
  const [historyFilter, setHistoryFilter] = useState<HistoryFilterType>('semua');
  const [historyScope, setHistoryScope] = useState<'semua' | 'saya'>('semua');
  const [historySearch, setHistorySearch] = useState<string>('');

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [nowTick, setNowTick] = useState<number>(Date.now());

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const collabTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const inlineTextareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);

  // Update relative timestamps every 10s
  useEffect(() => {
    const interval = window.setInterval(() => setNowTick(Date.now()), 10000);
    return () => window.clearInterval(interval);
  }, []);

  // Merge history entries idempotently and persist to localStorage
  const mergeHistoryEntries = useCallback((incoming: TextHistoryEntry | TextHistoryEntry[]) => {
    const list = Array.isArray(incoming) ? incoming : [incoming];
    setHistoryEntries((prev) => {
      const map = new Map<string, TextHistoryEntry>();
      for (const item of prev) {
        map.set(item.id, item);
      }
      for (const item of list) {
        if (item && item.id && item.content) {
          map.set(item.id, item);
        }
      }
      const merged = Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt).slice(0, 350);
      saveLocalHistory(merged);
      return merged;
    });
  }, []);

  // Preserve cursor position when updating collaborative text from another user
  const upsertClipPreservingCursor = useCallback(
    (incomingClip: SharedClip, editorClientId?: string, editorName?: string) => {
      // Check if user is currently focused on a textarea editing this clip
      const activeEl = document.activeElement;
      const collabEl = collabTextareaRef.current;
      const inlineEl = inlineTextareaRefs.current[incomingClip.id];
      const targetTextarea =
        activeEl === collabEl
          ? collabEl
          : activeEl === inlineEl
          ? inlineEl
          : null;

      let savedStart: number | null = null;
      let savedEnd: number | null = null;
      let previousTextLength = 0;

      if (targetTextarea && editorClientId && editorClientId !== identity.clientId) {
        savedStart = targetTextarea.selectionStart;
        savedEnd = targetTextarea.selectionEnd;
        previousTextLength = targetTextarea.value.length;
      }

      setClips((prev) => {
        const exists = prev.some((c) => c.id === incomingClip.id);
        if (exists) {
          return prev.map((c) => (c.id === incomingClip.id ? incomingClip : c));
        }
        return [incomingClip, ...prev];
      });

      if (editorClientId && editorClientId !== identity.clientId && editorName) {
        setLastLiveUpdateInfo({
          clipId: incomingClip.id,
          editorName,
          timestamp: Date.now(),
        });
      }

      // Restore cursor smoothly on next frame if another user edited the same text
      if (targetTextarea && savedStart !== null && savedEnd !== null) {
        const lengthDelta = incomingClip.content.length - previousTextLength;
        window.requestAnimationFrame(() => {
          try {
            const newStart = Math.max(
              0,
              Math.min(incomingClip.content.length, savedStart! + (savedStart! > 0 ? lengthDelta : 0))
            );
            const newEnd = Math.max(
              newStart,
              Math.min(incomingClip.content.length, savedEnd! + (savedEnd! > 0 ? lengthDelta : 0))
            );
            targetTextarea.setSelectionRange(newStart, newEnd);
          } catch {
            // Ignore selection error
          }
        });
      }
    },
    [identity.clientId]
  );

  const removeClipLocal = useCallback((id: string) => {
    setClips((prev) => prev.filter((c) => c.id !== id));
  }, []);

  // Send WebSocket event helper
  const sendWsEvent = useCallback((event: ClientEvent): boolean => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(event));
      return true;
    }
    return false;
  }, []);

  // Record a history entry (paste, copy, add, edit) both locally and on server
  const recordTextHistory = useCallback(
    (params: {
      action: HistoryActionType;
      content: string;
      title?: string;
      clipId?: string;
    }) => {
      const trimmed = (params.content || '').trim();
      if (!trimmed) return;

      const now = Date.now();
      const firstLine = trimmed.split('\n')[0].trim().slice(0, 65);
      const entryTitle = (params.title || '').trim() || firstLine || 'Teks Tanpa Judul';
      const entry: TextHistoryEntry = {
        id: `hist-${now}-${Math.random().toString(36).slice(2, 8)}`,
        action: params.action,
        title: entryTitle,
        content: trimmed,
        userName: userName.trim() || identity.defaultName,
        clientId: identity.clientId,
        clipId: params.clipId,
        createdAt: now,
      };

      mergeHistoryEntries(entry);
      broadcastChannelRef.current?.postMessage({
        type: 'history:created',
        entry,
      } satisfies ServerEvent);

      if (!sendWsEvent({ type: 'history:record', entry })) {
        fetch('/api/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry),
        }).catch(() => {});
      }
    },
    [identity.clientId, identity.defaultName, mergeHistoryEntries, sendWsEvent, userName]
  );

  // Fetch initial state via HTTP
  const fetchClipsFromServer = useCallback(async () => {
    try {
      const res = await fetch('/api/clips');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.clips)) {
        setClips(data.clips);
        setActiveCollabClipId((prev) => prev || data.clips[0]?.id || null);
      }
      if (Array.isArray(data.users)) {
        setOnlineUsers(data.users);
      }
      if (Array.isArray(data.history)) {
        mergeHistoryEntries(data.history);
      }
    } catch {
      // Reconnect handled by WebSocket
    } finally {
      setIsLoading(false);
    }
  }, [mergeHistoryEntries]);

  // Set up WebSocket + BroadcastChannel for real-time multi-user sync
  useEffect(() => {
    fetchClipsFromServer();

    if ('BroadcastChannel' in window) {
      const bc = new BroadcastChannel('tempelsalin_realtime_sync');
      bc.onmessage = (ev) => {
        const msg = ev.data as ServerEvent;
        if (!msg || !msg.type) return;
        if (msg.type === 'clip:created') {
          upsertClipPreservingCursor(msg.clip);
        } else if (msg.type === 'clip:updated') {
          upsertClipPreservingCursor(msg.clip, msg.editorClientId, msg.editorName);
        } else if (msg.type === 'clip:deleted') {
          removeClipLocal(msg.id);
        } else if (msg.type === 'history:created') {
          mergeHistoryEntries(msg.entry);
        } else if (msg.type === 'history:deleted') {
          setHistoryEntries((prev) => {
            const next = prev.filter((h) => h.id !== msg.id);
            saveLocalHistory(next);
            return next;
          });
        } else if (msg.type === 'history:cleared') {
          setHistoryEntries((prev) => {
            const next = msg.clientId
              ? prev.filter((h) => h.clientId !== msg.clientId)
              : [];
            saveLocalHistory(next);
            return next;
          });
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
              setActiveCollabClipId((prev) => prev || data.clips[0]?.id || null);
              setOnlineUsers(data.users);
              if (Array.isArray(data.history)) {
                mergeHistoryEntries(data.history);
              }
              setIsLoading(false);
              break;
            case 'clip:created':
              upsertClipPreservingCursor(data.clip);
              break;
            case 'clip:updated':
              upsertClipPreservingCursor(data.clip, data.editorClientId, data.editorName);
              break;
            case 'clip:deleted':
              removeClipLocal(data.id);
              break;
            case 'presence:updated':
              setOnlineUsers(data.users);
              break;
            case 'history:created':
              mergeHistoryEntries(data.entry);
              break;
            case 'history:deleted':
              setHistoryEntries((prev) => {
                const next = prev.filter((h) => h.id !== data.id);
                saveLocalHistory(next);
                return next;
              });
              break;
            case 'history:cleared':
              setHistoryEntries((prev) => {
                const next = data.clientId
                  ? prev.filter((h) => h.clientId !== data.clientId)
                  : [];
                saveLocalHistory(next);
                return next;
              });
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
  }, [
    fetchClipsFromServer,
    identity.clientId,
    identity.defaultName,
    mergeHistoryEntries,
    removeClipLocal,
    upsertClipPreservingCursor,
  ]);

  // Global paste listener to automatically log any text pasted anywhere on the page into Riwayat Teks
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      const pastedText = e.clipboardData?.getData('text/plain');
      if (pastedText && pastedText.trim().length > 0) {
        recordTextHistory({
          action: 'ditempel',
          content: pastedText,
          title: `Teks Ditempel: ${pastedText.trim().split('\n')[0].slice(0, 50)}`,
        });
      }
    };

    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [recordTextHistory]);

  // Currently selected clip for collaborative editing
  const activeCollabClip = useMemo(() => {
    if (!clips.length) return null;
    return clips.find((c) => c.id === activeCollabClipId) || clips[0];
  }, [clips, activeCollabClipId]);

  // Notify server which clip this user is currently viewing/editing
  const handleSelectClipForCollaboration = useCallback(
    (clipId: string, switchToCollabPanel = true) => {
      setActiveCollabClipId(clipId);
      if (switchToCollabPanel) {
        setLeftPanelMode('kolaborasi');
      }
      sendWsEvent({
        type: 'user:focus_clip',
        clientId: identity.clientId,
        activeClipId: clipId,
      });
    },
    [identity.clientId, sendWsEvent]
  );

  // Real-time Collaborative Edit Handler (streams changes immediately to all users viewing the same text)
  const handleLiveEditClip = useCallback(
    (
      clip: SharedClip,
      changes: {
        title?: string;
        content?: string;
        category?: ClipCategory;
        cursorOffset?: number | null;
        saveRevision?: boolean;
      }
    ) => {
      const nextTitle = changes.title !== undefined ? changes.title : clip.title;
      const nextContent = changes.content !== undefined ? changes.content : clip.content;
      const nextCategory = changes.category !== undefined ? changes.category : clip.category;
      const currentEditorName = userName.trim() || identity.defaultName;
      const now = Date.now();

      const optimisticClip: SharedClip = {
        ...clip,
        title: nextTitle,
        content: nextContent,
        category: nextCategory,
        lastEditor: currentEditorName,
        updatedAt: now,
      };

      // Update local state immediately
      setClips((prev) => prev.map((c) => (c.id === clip.id ? optimisticClip : c)));

      // Sync across local tabs immediately
      broadcastChannelRef.current?.postMessage({
        type: 'clip:updated',
        clip: optimisticClip,
        editorClientId: identity.clientId,
        editorName: currentEditorName,
      } satisfies ServerEvent);

      // Stream via WebSocket to all connected users
      const sentViaWs = sendWsEvent({
        type: 'clip:live_edit',
        id: clip.id,
        title: nextTitle,
        content: nextContent,
        category: nextCategory,
        editorName: currentEditorName,
        editorClientId: identity.clientId,
        cursorOffset: changes.cursorOffset,
        saveRevision: changes.saveRevision,
      });

      if (!sentViaWs) {
        fetch(`/api/clips/${encodeURIComponent(clip.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: nextTitle,
            content: nextContent,
            category: nextCategory,
            editorName: currentEditorName,
            editorClientId: identity.clientId,
            saveRevision: changes.saveRevision,
          }),
        }).catch(() => {});
      }

      if (typingTimeoutRef.current) {
        window.clearTimeout(typingTimeoutRef.current);
      }
      typingTimeoutRef.current = window.setTimeout(() => {
        sendWsEvent({
          type: 'user:typing',
          clientId: identity.clientId,
          isTyping: false,
          activeClipId: clip.id,
        });
      }, 1800);
    },
    [identity.clientId, identity.defaultName, sendWsEvent, userName]
  );

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
      activeClipId: activeCollabClip?.id || null,
    });
  };

  // Notify typing/pasting state in composer
  const handleContentChange = (value: string) => {
    setContent(value);
    sendWsEvent({
      type: 'user:typing',
      clientId: identity.clientId,
      isTyping: value.trim().length > 0,
      activeClipId: activeCollabClip?.id || null,
    });
    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = window.setTimeout(() => {
      sendWsEvent({
        type: 'user:typing',
        clientId: identity.clientId,
        isTyping: false,
        activeClipId: activeCollabClip?.id || null,
      });
    }, 2200);
  };

  // Read from system clipboard into composer or collaborative editor
  const handlePasteFromClipboard = async (target: 'composer' | 'collab') => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const clipText = await navigator.clipboard.readText();
        if (clipText) {
          recordTextHistory({
            action: 'ditempel',
            content: clipText,
            title: `Ditempel dari Clipboard: ${clipText.trim().split('\n')[0].slice(0, 50)}`,
            clipId: target === 'collab' ? activeCollabClip?.id : undefined,
          });

          if (target === 'collab' && activeCollabClip) {
            const combined = activeCollabClip.content
              ? `${activeCollabClip.content}\n${clipText}`
              : clipText;
            handleLiveEditClip(activeCollabClip, { content: combined, saveRevision: true });
            setComposerFeedback('Teks ditempel ke Editor Kolaborasi & disimpan ke Riwayat.');
            setTimeout(() => setComposerFeedback(null), 2500);
            collabTextareaRef.current?.focus();
          } else {
            handleContentChange(content ? `${content}\n${clipText}` : clipText);
            setComposerFeedback('Teks ditempel dari clipboard & tercatat di Riwayat Teks.');
            setTimeout(() => setComposerFeedback(null), 2500);
            textareaRef.current?.focus();
          }
          return;
        }
      }
    } catch {
      // Browser blocked programmatic readText inside iframe
    }
    if (target === 'collab') {
      collabTextareaRef.current?.focus();
    } else {
      textareaRef.current?.focus();
    }
    setComposerFeedback(
      'Tekan Ctrl+V (atau Cmd+V) langsung di kotak teks. Semua teks yang ditempel otomatis masuk ke Riwayat.'
    );
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
    const authorName = userName.trim() || identity.defaultName;

    const optimisticClip: SharedClip = {
      id: clipId,
      title: finalTitle,
      content: trimmed,
      author: authorName,
      authorId: identity.clientId,
      lastEditor: authorName,
      category,
      pinned: false,
      copyCount: 0,
      createdAt: now,
      updatedAt: now,
      revisions: [],
    };

    upsertClipPreservingCursor(optimisticClip);
    setActiveCollabClipId(clipId);
    broadcastChannelRef.current?.postMessage({ type: 'clip:created', clip: optimisticClip });

    // Record in local history immediately
    recordTextHistory({
      action: 'ditambahkan',
      title: finalTitle,
      content: trimmed,
      clipId,
    });

    setContent('');
    setTitle('');
    setComposerFeedback('Teks ditambahkan ke papan real-time & disimpan di Riwayat Teks!');
    setTimeout(() => setComposerFeedback(null), 2500);

    try {
      const res = await fetch('/api/clips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: clipId,
          title: finalTitle,
          content: trimmed,
          author: authorName,
          authorId: identity.clientId,
          category,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.clip) upsertClipPreservingCursor(data.clip);
      } else {
        sendWsEvent({
          type: 'clip:create',
          id: clipId,
          title: finalTitle,
          content: trimmed,
          author: authorName,
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
        author: authorName,
        authorId: identity.clientId,
        category,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Copy clip content ("Salin") and record to History
  const handleCopyClip = async (clip: SharedClip) => {
    const ok = await copyTextToClipboard(clip.content);
    if (ok) {
      setCopiedId(clip.id);
      setTimeout(() => {
        setCopiedId((prev) => (prev === clip.id ? null : prev));
      }, 2000);

      const updated = { ...clip, copyCount: clip.copyCount + 1, updatedAt: Date.now() };
      upsertClipPreservingCursor(updated);
      broadcastChannelRef.current?.postMessage({ type: 'clip:updated', clip: updated });

      // Record copy action to history
      recordTextHistory({
        action: 'disalin',
        title: clip.title,
        content: clip.content,
        clipId: clip.id,
      });

      if (
        !sendWsEvent({
          type: 'clip:copy',
          id: clip.id,
          userName: userName.trim() || identity.defaultName,
          clientId: identity.clientId,
        })
      ) {
        fetch(`/api/clips/${encodeURIComponent(clip.id)}/copy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userName: userName.trim() || identity.defaultName,
            clientId: identity.clientId,
          }),
        }).catch(() => {});
      }
    }
  };

  // Copy from a History item
  const handleCopyHistoryItem = async (entry: TextHistoryEntry) => {
    const ok = await copyTextToClipboard(entry.content);
    if (ok) {
      setCopiedId(entry.id);
      setTimeout(() => {
        setCopiedId((prev) => (prev === entry.id ? null : prev));
      }, 2000);

      recordTextHistory({
        action: 'disalin',
        title: entry.title,
        content: entry.content,
        clipId: entry.clipId,
      });
    }
  };

  // Delete single history item
  const handleDeleteHistoryItem = (id: string) => {
    setHistoryEntries((prev) => {
      const next = prev.filter((h) => h.id !== id);
      saveLocalHistory(next);
      return next;
    });
    broadcastChannelRef.current?.postMessage({ type: 'history:deleted', id } satisfies ServerEvent);
    if (!sendWsEvent({ type: 'history:delete', id })) {
      fetch(`/api/history/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
    }
  };

  // Clear history
  const handleClearHistory = () => {
    const targetClientId = historyScope === 'saya' ? identity.clientId : undefined;
    setHistoryEntries((prev) => {
      const next = targetClientId ? prev.filter((h) => h.clientId !== targetClientId) : [];
      saveLocalHistory(next);
      return next;
    });
    broadcastChannelRef.current?.postMessage({
      type: 'history:cleared',
      clientId: targetClientId,
    } satisfies ServerEvent);

    if (!sendWsEvent({ type: 'history:clear', clientId: targetClientId })) {
      const q = targetClientId ? `?clientId=${encodeURIComponent(targetClientId)}` : '';
      fetch(`/api/history${q}`, { method: 'DELETE' }).catch(() => {});
    }
  };

  // Toggle Pin
  const handleTogglePin = async (clip: SharedClip) => {
    const updated = { ...clip, pinned: !clip.pinned, updatedAt: Date.now() };
    upsertClipPreservingCursor(updated);
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
  const handleDownloadClip = (clipTitle: string, clipContent: string) => {
    const blob = new Blob([clipContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeFilename = clipTitle
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
        if (activeTab === 'kode' && clip.category !== 'kode') return false;
        if (!q) return true;
        return (
          clip.content.toLowerCase().includes(q) ||
          clip.title.toLowerCase().includes(q) ||
          clip.author.toLowerCase().includes(q) ||
          (clip.lastEditor && clip.lastEditor.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (sortMode === 'populer') {
          if (b.copyCount !== a.copyCount) return b.copyCount - a.copyCount;
        }
        return b.updatedAt - a.updatedAt;
      });
  }, [clips, activeTab, searchQuery, sortMode]);

  // Filtered history entries
  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return historyEntries.filter((entry) => {
      if (historyScope === 'saya' && entry.clientId !== identity.clientId) return false;
      if (historyFilter === 'disalin' && entry.action !== 'disalin') return false;
      if (
        historyFilter === 'ditempel' &&
        entry.action !== 'ditempel' &&
        entry.action !== 'ditambahkan'
      ) {
        return false;
      }
      if (historyFilter === 'diedit' && entry.action !== 'diedit') return false;
      if (!q) return true;
      return (
        entry.content.toLowerCase().includes(q) ||
        entry.title.toLowerCase().includes(q) ||
        entry.userName.toLowerCase().includes(q)
      );
    });
  }, [historyEntries, historyScope, historyFilter, historySearch, identity.clientId]);

  // Users viewing/editing each clip
  const usersByClipId = useMemo(() => {
    const map: Record<string, ConnectedUser[]> = {};
    for (const u of onlineUsers) {
      if (u.activeClipId) {
        if (!map[u.activeClipId]) map[u.activeClipId] = [];
        map[u.activeClipId].push(u);
      }
    }
    return map;
  }, [onlineUsers]);

  const otherTypingUsers = useMemo(
    () => onlineUsers.filter((u) => u.isTyping && u.clientId !== identity.clientId),
    [onlineUsers, identity.clientId]
  );

  const charCount = content.length;
  const lineCount = content ? content.split('\n').length : 0;

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-slate-900">
      {/* Top Bar Contract: Zone 1 (Brand) — Zone 2 (5 Nav Links) — Zone 3 (Primary Actions) */}
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
                { id: 'kolaborasi', label: 'Kolaborasi Live' },
                { id: 'riwayat', label: `Riwayat Teks (${historyEntries.length})` },
                { id: 'kode', label: 'Kode & Teknis' },
                { id: 'disematkan', label: 'Disematkan' },
              ] as { id: MainViewTab; label: string }[]
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  if (item.id === 'kolaborasi') {
                    setLeftPanelMode('kolaborasi');
                  }
                }}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
                  activeTab === item.id
                    ? 'border-blue-600 text-slate-900 font-semibold'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Zone 3: 2 Primary Actions */}
          <div className="flex items-center gap-2.5">
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
                title="Klik untuk mengubah nama pengirim / kolaborator"
                className="px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200/80 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <User className="w-3.5 h-3.5 text-slate-500" />
                <span className="truncate max-w-[120px]">{userName}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setActiveTab(activeTab === 'riwayat' ? 'semua' : 'riwayat');
              }}
              className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'riwayat'
                  ? 'bg-slate-900 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>{activeTab === 'riwayat' ? 'Kembali ke Papan' : 'Riwayat Teks'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace Container (1200px max width, structured 12-column grid on desktop) */}
      <main className="flex-1 max-w-[1200px] w-full mx-auto px-4 sm:px-8 py-6 sm:py-8">
        {/* Mobile Navigation Switcher */}
        <div className="flex md:hidden items-center gap-1.5 overflow-x-auto pb-4 mb-2 border-b border-slate-200">
          {(
            [
              { id: 'semua', label: 'Semua Teks' },
              { id: 'kolaborasi', label: 'Kolaborasi Live' },
              { id: 'riwayat', label: `Riwayat (${historyEntries.length})` },
              { id: 'kode', label: 'Kode' },
              { id: 'disematkan', label: 'Disematkan' },
            ] as { id: MainViewTab; label: string }[]
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                if (tab.id === 'kolaborasi') setLeftPanelMode('kolaborasi');
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-white border border-slate-200 text-slate-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column (5 cols on desktop): Dual-Mode Workspace (Tempel Baru OR Editor Kolaborasi Real-Time) + Presence + Quick History */}
          <section className="lg:col-span-5 lg:sticky lg:top-20 space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6">
              {/* Mode Switcher: Tempel Teks Baru vs Editor Kolaborasi Bersama */}
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-lg mb-5">
                <button
                  type="button"
                  onClick={() => setLeftPanelMode('tambah')}
                  className={`py-2 px-3 text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                    leftPanelMode === 'tambah'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5 text-blue-600" />
                  <span>Tempel Teks Baru</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLeftPanelMode('kolaborasi');
                    if (!activeCollabClipId && clips[0]) {
                      handleSelectClipForCollaboration(clips[0].id, false);
                    }
                  }}
                  className={`py-2 px-3 text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                    leftPanelMode === 'kolaborasi'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Edit3 className="w-3.5 h-3.5 text-blue-600" />
                  <span>Edit Kolaborasi Live</span>
                </button>
              </div>

              {leftPanelMode === 'tambah' ? (
                /* MODE 1: TEMPEL & TAMBAHKAN TEKS BARU */
                <>
                  <div className="flex items-center justify-between gap-2 mb-4">
                    <div>
                      <h1 className="text-base font-bold text-slate-900 tracking-tight">
                        Tempel & Bagikan Teks
                      </h1>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Semua teks yang ditempel otomatis tersimpan di Riwayat & tampil real-time.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handlePasteFromClipboard('composer')}
                      className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                      title="Tempel langsung dari clipboard perangkat Anda"
                    >
                      <ClipboardPaste className="w-3.5 h-3.5 text-blue-600" />
                      <span>Tempel Clipboard</span>
                    </button>
                  </div>

                  <form onSubmit={handleAddClip} className="space-y-3.5">
                    <div>
                      <label
                        htmlFor="clip-title"
                        className="block text-xs font-medium text-slate-700 mb-1"
                      >
                        Judul / Keterangan{' '}
                        <span className="text-slate-400 font-normal">(opsional)</span>
                      </label>
                      <input
                        id="clip-title"
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Contoh: Catatan Rapat, Snippet Kode, Link Penting..."
                        maxLength={120}
                        className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label
                          htmlFor="clip-content"
                          className="block text-xs font-medium text-slate-700"
                        >
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

                    {composerFeedback && (
                      <p className="text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                        {composerFeedback}
                      </p>
                    )}

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
                  </form>
                </>
              ) : (
                /* MODE 2: EDITOR KOLABORASI REAL-TIME (MULTI-USER SIMULTANEOUS EDITING) */
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="text-base font-bold text-slate-900 tracking-tight">
                        Editor Kolaborasi Real-Time
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Ketik atau ubah teks di bawah. Semua pengguna yang melihat teks ini langsung menerima perubahan Anda detik ini juga.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handlePasteFromClipboard('collab')}
                      className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <ClipboardPaste className="w-3.5 h-3.5 text-blue-600" />
                      <span>Tempel</span>
                    </button>
                  </div>

                  {/* Selector for which shared clip to edit collaboratively */}
                  <div>
                    <label
                      htmlFor="collab-clip-select"
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      Pilih Teks yang Diedit Bersama:
                    </label>
                    <select
                      id="collab-clip-select"
                      value={activeCollabClip?.id || ''}
                      onChange={(e) => handleSelectClipForCollaboration(e.target.value, false)}
                      className="w-full px-3 py-2 text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                    >
                      {clips.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title} ({c.author})
                        </option>
                      ))}
                    </select>
                  </div>

                  {activeCollabClip ? (
                    <div className="space-y-3">
                      {/* Live Viewers / Collaborators on this specific text */}
                      <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200/80 rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <Eye className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                          <span>
                            Sedang membuka teks ini:{' '}
                            <strong className="text-slate-900">
                              {(usersByClipId[activeCollabClip.id] || [])
                                .map((u) =>
                                  u.clientId === identity.clientId ? `${u.name} (Anda)` : u.name
                                )
                                .join(', ') || `${userName} (Anda)`}
                            </strong>
                          </span>
                        </div>
                        <span className="font-mono tabular-nums text-[11px] text-slate-500">
                          Diedit oleh: {activeCollabClip.lastEditor || activeCollabClip.author}
                        </span>
                      </div>

                      {/* Collaborative Title Input */}
                      <div>
                        <label
                          htmlFor="collab-title-input"
                          className="block text-xs font-medium text-slate-700 mb-1"
                        >
                          Judul Teks Bersama
                        </label>
                        <input
                          id="collab-title-input"
                          type="text"
                          value={activeCollabClip.title}
                          onFocus={() =>
                            handleSelectClipForCollaboration(activeCollabClip.id, false)
                          }
                          onChange={(e) =>
                            handleLiveEditClip(activeCollabClip, { title: e.target.value })
                          }
                          className="w-full px-3.5 py-2 text-sm font-medium bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                      </div>

                      {/* Collaborative Live Content Textarea */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label
                            htmlFor="collab-content-textarea"
                            className="block text-xs font-medium text-slate-700"
                          >
                            Isi Teks (Sinkronisasi Ketikan Real-Time)
                          </label>
                          <span className="text-xs text-slate-400 font-mono tabular-nums">
                            {activeCollabClip.content.length.toLocaleString('id-ID')} karakter
                          </span>
                        </div>
                        <textarea
                          id="collab-content-textarea"
                          ref={collabTextareaRef}
                          rows={9}
                          value={activeCollabClip.content}
                          onFocus={(e) =>
                            sendWsEvent({
                              type: 'user:focus_clip',
                              clientId: identity.clientId,
                              activeClipId: activeCollabClip.id,
                              cursorOffset: e.currentTarget.selectionStart,
                            })
                          }
                          onChange={(e) =>
                            handleLiveEditClip(activeCollabClip, {
                              content: e.target.value,
                              cursorOffset: e.currentTarget.selectionStart,
                            })
                          }
                          placeholder="Ketik atau tempel di sini untuk mengedit bersama secara real-time..."
                          className="w-full p-3.5 text-sm font-mono bg-slate-50 border border-blue-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 transition-all resize-y leading-relaxed"
                        />
                      </div>

                      {lastLiveUpdateInfo &&
                        lastLiveUpdateInfo.clipId === activeCollabClip.id &&
                        nowTick - lastLiveUpdateInfo.timestamp < 15000 && (
                          <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5">
                            Diperbarui secara real-time oleh{' '}
                            <strong>{lastLiveUpdateInfo.editorName}</strong> baru saja.
                          </p>
                        )}

                      {composerFeedback && (
                        <p className="text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                          {composerFeedback}
                        </p>
                      )}

                      {/* Collaborative Actions: Copy & Save Version Checkpoint to History */}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleCopyClip(activeCollabClip)}
                          className="flex-1 py-2 px-3 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          {copiedId === activeCollabClip.id ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span>Tersalin!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Salin Teks Ini</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            handleLiveEditClip(activeCollabClip, {
                              content: activeCollabClip.content,
                              saveRevision: true,
                            });
                            recordTextHistory({
                              action: 'diedit',
                              title: activeCollabClip.title,
                              content: activeCollabClip.content,
                              clipId: activeCollabClip.id,
                            });
                            setComposerFeedback(
                              'Versi teks saat ini berhasil disimpan ke Riwayat Teks!'
                            );
                            setTimeout(() => setComposerFeedback(null), 2500);
                          }}
                          className="py-2 px-3 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                          title="Simpan cadangan versi teks ini ke daftar Riwayat Teks"
                        >
                          <Save className="w-3.5 h-3.5 text-slate-600" />
                          <span>Simpan ke Riwayat</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Belum ada teks untuk diedit. Tambahkan teks baru terlebih dahulu.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Active Users & Real-Time Presence Card */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 font-semibold text-slate-800">
                  <Users className="w-4 h-4 text-slate-500" />
                  <span>Kolaborator Terhubung</span>
                </div>
                <span className="font-mono tabular-nums text-slate-600">
                  {Math.max(1, onlineUsers.length)} aktif ·{' '}
                  {isConnected ? 'Real-Time Aktif' : 'Menyambungkan...'}
                </span>
              </div>

              <div className="text-xs text-slate-600 leading-relaxed flex flex-wrap items-center gap-x-2 gap-y-1">
                {onlineUsers.length === 0 ? (
                  <span>{userName} (Anda)</span>
                ) : (
                  onlineUsers.map((u, idx) => {
                    const focusedClip = clips.find((c) => c.id === u.activeClipId);
                    return (
                      <React.Fragment key={u.clientId}>
                        {idx > 0 && <span aria-hidden="true">·</span>}
                        <span
                          className={
                            u.clientId === identity.clientId
                              ? 'font-semibold text-slate-900'
                              : 'text-slate-700'
                          }
                        >
                          {u.name}
                          {u.clientId === identity.clientId ? ' (Anda)' : ''}
                          {u.isTyping ? ' [mengetik...]' : ''}
                          {focusedClip
                            ? ` — di "${focusedClip.title.slice(0, 18)}${
                                focusedClip.title.length > 18 ? '…' : ''
                              }"`
                            : ''}
                        </span>
                      </React.Fragment>
                    );
                  })
                )}
              </div>

              {otherTypingUsers.length > 0 && (
                <p className="text-xs text-blue-600 font-medium pt-1 border-t border-slate-100">
                  {otherTypingUsers.map((u) => u.name).join(', ')} sedang mengedit teks secara langsung...
                </p>
              )}
            </div>

            {/* Quick Access Recent History Preview Card (Always visible on sidebar so users can see recent copied/pasted texts at a glance) */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                  <History className="w-4 h-4 text-slate-500" />
                  <span>Riwayat Salin & Tempel Terbaru</span>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('riwayat')}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer"
                >
                  <span>Lihat Semua ({historyEntries.length})</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {historyEntries.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Belum ada riwayat. Setiap teks yang Anda salin atau tempel akan tercatat otomatis di sini.
                </p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {historyEntries.slice(0, 4).map((item) => (
                    <div
                      key={item.id}
                      className="py-2.5 first:pt-0 last:pb-0 flex items-start justify-between gap-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-500 tabular-nums">
                          <span className="font-semibold text-slate-700">
                            {ACTION_LABELS[item.action]}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{formatRelativeTime(item.createdAt, nowTick)}</span>
                        </div>
                        <p className="text-xs font-mono text-slate-800 truncate mt-0.5">
                          {item.content}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopyHistoryItem(item)}
                        className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors shrink-0 cursor-pointer"
                        title="Salin kembali teks ini"
                      >
                        {copiedId === item.id ? 'Tersalin' : 'Salin'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Right / Main Column (7 cols on desktop): Either Riwayat Teks Full View OR Shared Collaborative Text Stream */}
          <section className="lg:col-span-7 space-y-4">
            {activeTab === 'riwayat' ? (
              /* ============================================================
                 VIEW: DAFTAR RIWAYAT TEKS (CLIPBOARD & TEXT HISTORY)
                 ============================================================ */
              <div className="space-y-4">
                <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                        Riwayat Teks (Disalin, Ditempel & Diedit)
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Menyimpan semua teks yang pernah ditempel atau disalin agar Anda dapat melihat dan menggunakannya kembali kapan saja.
                      </p>
                    </div>
                    {historyEntries.length > 0 && (
                      <button
                        type="button"
                        onClick={handleClearHistory}
                        className="px-3 py-1.5 text-xs font-medium text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors flex items-center gap-1.5 self-start sm:self-auto shrink-0 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>
                          {historyScope === 'saya' ? 'Bersihkan Riwayat Saya' : 'Bersihkan Semua'}
                        </span>
                      </button>
                    )}
                  </div>

                  {/* Search & Filter Controls for History */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                    <div className="relative flex-1">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="search"
                        value={historySearch}
                        onChange={(e) => setHistorySearch(e.target.value)}
                        placeholder="Cari di dalam riwayat teks sebelumnya..."
                        className="w-full pl-9 pr-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>

                    {/* Scope Switcher: Semua Pengguna vs Riwayat Saya */}
                    <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0">
                      <button
                        type="button"
                        onClick={() => setHistoryScope('semua')}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                          historyScope === 'semua'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Semua Pengguna
                      </button>
                      <button
                        type="button"
                        onClick={() => setHistoryScope('saya')}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                          historyScope === 'saya'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Riwayat Saya
                      </button>
                    </div>
                  </div>

                  {/* Filter by Action Type */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(
                        [
                          { id: 'semua', label: 'Semua Aktivitas' },
                          { id: 'disalin', label: 'Pernah Disalin (Copy)' },
                          { id: 'ditempel', label: 'Pernah Ditempel (Paste)' },
                          { id: 'diedit', label: 'Versi Edit Kolaborasi' },
                        ] as { id: HistoryFilterType; label: string }[]
                      ).map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setHistoryFilter(f.id)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                            historyFilter === f.id
                              ? 'bg-slate-900 text-white'
                              : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>

                    <span className="text-xs text-slate-500 font-mono tabular-nums">
                      {filteredHistory.length} entri riwayat
                    </span>
                  </div>
                </div>

                {/* History Items List */}
                {filteredHistory.length === 0 ? (
                  <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
                    <Clock className="w-8 h-8 text-slate-400 mx-auto" />
                    <div className="space-y-1">
                      <h3 className="text-base font-semibold text-slate-900">
                        Belum ada riwayat teks yang cocok
                      </h3>
                      <p className="text-xs text-slate-500 max-w-md mx-auto">
                        Setiap kali Anda menyalin teks dari papan atau menempelkan teks dari clipboard (`Ctrl+V`), teks tersebut akan langsung tersimpan di daftar ini.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredHistory.map((entry) => {
                      const isCopied = copiedId === entry.id;
                      const lines = entry.content.split('\n');
                      const isExpanded = Boolean(expandedIds[entry.id]);
                      const isLong = entry.content.length > 360 || lines.length > 6;
                      const displayContent =
                        isLong && !isExpanded
                          ? lines.slice(0, 6).join('\n').slice(0, 360) + '...'
                          : entry.content;

                      return (
                        <article
                          key={entry.id}
                          className="bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-5 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-4 mb-3">
                            <div className="min-w-0 flex-1">
                              <h3 className="text-sm font-semibold text-slate-900 break-words">
                                {entry.title}
                              </h3>
                              {/* Unboxed metadata row with · separators */}
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 mt-1 tabular-nums">
                                <span className="font-semibold text-blue-600">
                                  {ACTION_LABELS[entry.action]}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className="font-medium text-slate-700">{entry.userName}</span>
                                <span aria-hidden="true">·</span>
                                <span>{formatRelativeTime(entry.createdAt, nowTick)}</span>
                                <span aria-hidden="true">·</span>
                                <span>{formatClockTime(entry.createdAt)}</span>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => handleCopyHistoryItem(entry)}
                                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
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
                                    <span>Salin Kembali</span>
                                  </>
                                )}
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setLeftPanelMode('tambah');
                                  setTitle(entry.title);
                                  setContent(entry.content);
                                  setComposerFeedback(
                                    'Teks dari riwayat dimuat ke kotak input. Klik "Tambahkan" untuk membagikan.'
                                  );
                                  setTimeout(() => setComposerFeedback(null), 3000);
                                  window.scrollTo({ top: 0, behavior: 'smooth' });
                                }}
                                title="Gunakan kembali teks ini di kotak input"
                                className="px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">Muat ke Input</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDeleteHistoryItem(entry.id)}
                                title="Hapus dari riwayat"
                                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          <pre
                            onClick={() => handleCopyHistoryItem(entry)}
                            title="Klik untuk menyalin kembali teks ini"
                            className="w-full p-3.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200/80 rounded-lg text-xs sm:text-sm font-mono text-slate-800 whitespace-pre-wrap break-words overflow-x-auto leading-relaxed cursor-pointer transition-colors"
                          >
                            {displayContent}
                          </pre>

                          <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 tabular-nums">
                            <span>
                              {entry.content.length.toLocaleString('id-ID')} karakter · {lines.length}{' '}
                              baris
                            </span>
                            {isLong && (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedIds((prev) => ({
                                    ...prev,
                                    [entry.id]: !isExpanded,
                                  }))
                                }
                                className="text-slate-700 hover:text-slate-900 font-medium flex items-center gap-1 cursor-pointer"
                              >
                                {isExpanded ? (
                                  <>
                                    <span>Ringkas</span>
                                    <ChevronUp className="w-3.5 h-3.5" />
                                  </>
                                ) : (
                                  <>
                                    <span>Lihat Selengkapnya</span>
                                    <ChevronDown className="w-3.5 h-3.5" />
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              /* ============================================================
                 VIEW: DAFTAR TEKS BERSAMA & KOLABORASI REAL-TIME
                 ============================================================ */
              <>
                {/* Search & Filter Control Bar */}
                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
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
                        Terbaru Diperbarui
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

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100 text-xs text-slate-500">
                    <span className="font-mono tabular-nums">
                      Menampilkan {filteredClips.length} dari {clips.length} teks bersama
                    </span>
                    <span>
                      Klik <strong>Edit Bersama (Live)</strong> pada teks mana pun untuk mengedit bersama pengguna lain secara real-time.
                    </span>
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
                          : 'Tempelkan teks baru pada panel di samping lalu klik tombol "Tambahkan" agar seluruh pengguna dapat melihat, mengedit bersama, dan menyalinnya.'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3.5">
                    {filteredClips.map((clip) => {
                      const isCopied = copiedId === clip.id;
                      const isExpanded = Boolean(expandedIds[clip.id]);
                      const isInlineEditing =
                        inlineEditingClipId === clip.id || activeTab === 'kolaborasi';
                      const isSelectedInCollabPanel =
                        leftPanelMode === 'kolaborasi' && activeCollabClip?.id === clip.id;
                      const lines = clip.content.split('\n');
                      const isLong = clip.content.length > 420 || lines.length > 8;
                      const displayContent =
                        isLong && !isExpanded
                          ? lines.slice(0, 8).join('\n').slice(0, 420) + '...'
                          : clip.content;
                      const firstUrl = extractFirstUrl(clip.content);
                      const activeViewers = usersByClipId[clip.id] || [];
                      const revisions = clip.revisions || [];
                      const showingRevisions = showRevisionsForClipId === clip.id;

                      return (
                        <article
                          key={clip.id}
                          className={`bg-white border rounded-xl p-5 transition-colors ${
                            isInlineEditing || isSelectedInCollabPanel
                              ? 'border-blue-500 ring-1 ring-blue-500/20'
                              : clip.pinned
                              ? 'border-blue-300'
                              : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          {/* Card Top Row: Title + Primary Copy & Live Collaborative Edit Actions */}
                          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-3">
                            <div className="min-w-0 flex-1">
                              {isInlineEditing ? (
                                <input
                                  type="text"
                                  value={clip.title}
                                  onFocus={() =>
                                    handleSelectClipForCollaboration(clip.id, false)
                                  }
                                  onChange={(e) =>
                                    handleLiveEditClip(clip, { title: e.target.value })
                                  }
                                  aria-label="Judul teks kolaborasi"
                                  className="w-full px-2.5 py-1 text-base font-semibold text-slate-900 bg-slate-50 border border-blue-300 rounded-md focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                                />
                              ) : (
                                <h2 className="text-base font-semibold text-slate-900 leading-snug break-words">
                                  {clip.title}
                                </h2>
                              )}

                              {/* Zero-Pill Metadata Discipline: Clean unboxed inline text with · separators */}
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 mt-1 tabular-nums">
                                {clip.pinned && (
                                  <>
                                    <span className="font-semibold text-blue-600">Disematkan</span>
                                    <span aria-hidden="true">·</span>
                                  </>
                                )}
                                <span className="font-medium text-slate-700">{clip.author}</span>
                                {clip.lastEditor && clip.lastEditor !== clip.author && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span>Diedit oleh {clip.lastEditor}</span>
                                  </>
                                )}
                                <span aria-hidden="true">·</span>
                                <span>{CATEGORY_LABELS[clip.category]}</span>
                                <span aria-hidden="true">·</span>
                                <span>Diperbarui {formatRelativeTime(clip.updatedAt, nowTick)}</span>
                                {activeViewers.length > 0 && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="text-blue-600 font-medium">
                                      Dibuka oleh:{' '}
                                      {activeViewers
                                        .map((u) =>
                                          u.clientId === identity.clientId
                                            ? `${u.name} (Anda)`
                                            : u.name
                                        )
                                        .join(', ')}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Action Bar: Salin Teks + Edit Bersama (Live) + Pin + Download + Delete */}
                            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
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
                                onClick={() => {
                                  if (inlineEditingClipId === clip.id) {
                                    setInlineEditingClipId(null);
                                  } else {
                                    setInlineEditingClipId(clip.id);
                                    handleSelectClipForCollaboration(clip.id, true);
                                  }
                                }}
                                className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                                  isInlineEditing
                                    ? 'bg-slate-900 border-slate-900 text-white'
                                    : 'bg-white border-slate-200 text-slate-700 hover:text-slate-900 hover:bg-slate-50'
                                }`}
                                title="Edit teks ini secara langsung bersama pengguna lain"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                <span>{isInlineEditing ? 'Selesai Edit' : 'Edit Bersama'}</span>
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
                                onClick={() => handleDownloadClip(clip.title, clip.content)}
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

                          {/* Shared Text Content Area: Either Live Collaborative Textarea or Instant Copy Pre Block */}
                          {isInlineEditing ? (
                            <div className="space-y-2">
                              <textarea
                                ref={(el) => {
                                  inlineTextareaRefs.current[clip.id] = el;
                                }}
                                rows={Math.min(14, Math.max(5, lines.length + 1))}
                                value={clip.content}
                                onFocus={(e) =>
                                  sendWsEvent({
                                    type: 'user:focus_clip',
                                    clientId: identity.clientId,
                                    activeClipId: clip.id,
                                    cursorOffset: e.currentTarget.selectionStart,
                                  })
                                }
                                onChange={(e) =>
                                  handleLiveEditClip(clip, {
                                    content: e.target.value,
                                    cursorOffset: e.currentTarget.selectionStart,
                                  })
                                }
                                className="w-full p-3.5 bg-white border border-blue-400 rounded-lg text-xs sm:text-sm font-mono text-slate-900 leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-600 resize-y"
                              />
                              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                                <span>
                                  Mode Kolaborasi Real-Time aktif — Setiap ketikan langsung terlihat oleh semua pengguna yang membuka teks ini.
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleLiveEditClip(clip, {
                                      content: clip.content,
                                      saveRevision: true,
                                    });
                                    recordTextHistory({
                                      action: 'diedit',
                                      title: clip.title,
                                      content: clip.content,
                                      clipId: clip.id,
                                    });
                                  }}
                                  className="text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1 cursor-pointer"
                                >
                                  <Save className="w-3.5 h-3.5" />
                                  <span>Simpan Versi ke Riwayat</span>
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="relative group">
                              <pre
                                onClick={() => handleCopyClip(clip)}
                                title="Klik untuk langsung menyalin teks ini"
                                className="w-full p-3.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200/80 rounded-lg text-xs sm:text-sm font-mono text-slate-800 whitespace-pre-wrap break-words overflow-x-auto leading-relaxed cursor-pointer transition-colors"
                              >
                                {displayContent}
                              </pre>
                            </div>
                          )}

                          {/* Optional Revision History Drawer for this Clip */}
                          {showingRevisions && revisions.length > 0 && (
                            <div className="mt-3 p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5">
                              <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                                <span>Versi Teks Sebelumnya ({revisions.length})</span>
                                <button
                                  type="button"
                                  onClick={() => setShowRevisionsForClipId(null)}
                                  className="text-slate-500 hover:text-slate-800 cursor-pointer"
                                >
                                  Tutup
                                </button>
                              </div>
                              <div className="divide-y divide-slate-200/70 max-h-60 overflow-y-auto">
                                {revisions.map((rev) => (
                                  <div
                                    key={rev.id}
                                    className="py-2 first:pt-0 last:pb-0 flex items-start justify-between gap-3"
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="text-[11px] text-slate-500 tabular-nums">
                                        Oleh <strong>{rev.editorName}</strong> ·{' '}
                                        {formatRelativeTime(rev.timestamp, nowTick)} (
                                        {formatClockTime(rev.timestamp)})
                                      </div>
                                      <p className="text-xs font-mono text-slate-700 line-clamp-2 mt-0.5 break-words">
                                        {rev.content}
                                      </p>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleLiveEditClip(clip, {
                                          title: rev.title,
                                          content: rev.content,
                                          saveRevision: true,
                                        })
                                      }
                                      className="px-2.5 py-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 bg-white border border-slate-200 rounded-md shrink-0 cursor-pointer"
                                    >
                                      Pulihkan Versi Ini
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Card Footer: Unboxed tabular metrics & Expand/Link/Revision actions */}
                          <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 tabular-nums">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span>{clip.content.length.toLocaleString('id-ID')} karakter</span>
                              <span aria-hidden="true">·</span>
                              <span>{lines.length} baris</span>
                              <span aria-hidden="true">·</span>
                              <span>Disalin {clip.copyCount} kali</span>
                              {revisions.length > 0 && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setShowRevisionsForClipId(
                                        showingRevisions ? null : clip.id
                                      )
                                    }
                                    className="text-blue-600 hover:underline font-medium cursor-pointer"
                                  >
                                    {revisions.length} versi sebelumnya
                                  </button>
                                </>
                              )}
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

                              {!isInlineEditing && isLong && (
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
              </>
            )}
          </section>
        </div>
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 px-4 sm:px-8 mt-12">
        <div className="max-w-[1200px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>TempelSalin — Papan Klip & Kolaborasi Teks Real-Time</span>
          <span>
            Semua aktivitas salin, tempel, dan edit kolaborasi tersimpan otomatis di menu Riwayat Teks.
          </span>
        </div>
      </footer>
    </div>
  );
}
