import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  SharedClip,
  ConnectedUser,
  ClientEvent,
  ServerEvent,
  ClipCategory,
  TextHistoryEntry,
  HistoryActionType,
} from './src/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const CLIPS_FILE = path.join(DATA_DIR, 'shared-clips.json');
const HISTORY_FILE = path.join(DATA_DIR, 'shared-history.json');

const INITIAL_CLIPS: SharedClip[] = [
  {
    id: 'clip-welcome-1',
    title: 'Dokumen Kolaborasi Real-Time — Panduan & Catatan Bersama',
    content: `Selamat datang di Ruang Kolaborasi TempelSalin!
Semua pengguna yang membuka teks ini dapat mengeditnya secara bersamaan dan melihat perubahan secara langsung (real-time).

Daftar Agenda Tim Hari Ini:
1. Uji coba edit teks bersama secara real-time antar pengguna.
2. Tempelkan potongan kode atau tautan baru di panel kiri.
3. Cek tab "Riwayat Teks" untuk melihat kembali semua teks yang pernah disalin atau ditempel.`,
    author: 'Sistem',
    authorId: 'system-seed',
    lastEditor: 'Sistem',
    category: 'umum',
    pinned: true,
    copyCount: 14,
    createdAt: Date.now() - 1000 * 60 * 25,
    updatedAt: Date.now() - 1000 * 60 * 5,
    revisions: [],
  },
  {
    id: 'clip-code-2',
    title: 'Perintah Deploy & Cek Status Container',
    content: `docker compose pull && docker compose up -d --build
docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"
curl -I http://localhost:3000/api/health`,
    author: 'Raka Wijaya',
    authorId: 'seed-user-1',
    lastEditor: 'Raka Wijaya',
    category: 'kode',
    pinned: false,
    copyCount: 8,
    createdAt: Date.now() - 1000 * 60 * 12,
    updatedAt: Date.now() - 1000 * 60 * 12,
    revisions: [],
  },
  {
    id: 'clip-link-3',
    title: 'Format Template Laporan Harian Tim',
    content: `Laporan Harian — [Nama Lengkap]
• Selesai hari ini: Integrasi sinkronisasi teks real-time antar perangkat
• Sedang dikerjakan: Pengujian salin satu-klik di browser mobile & desktop
• Kendala: Tidak ada`,
    author: 'Nadia Putri',
    authorId: 'seed-user-2',
    lastEditor: 'Nadia Putri',
    category: 'tautan',
    pinned: false,
    copyCount: 5,
    createdAt: Date.now() - 1000 * 60 * 4,
    updatedAt: Date.now() - 1000 * 60 * 4,
    revisions: [],
  },
];

const INITIAL_HISTORY: TextHistoryEntry[] = [
  {
    id: 'hist-seed-1',
    action: 'ditempel',
    title: 'Perintah Deploy & Cek Status Container',
    content: `docker compose pull && docker compose up -d --build
docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"
curl -I http://localhost:3000/api/health`,
    userName: 'Raka Wijaya',
    clientId: 'seed-user-1',
    clipId: 'clip-code-2',
    createdAt: Date.now() - 1000 * 60 * 12,
  },
  {
    id: 'hist-seed-2',
    action: 'disalin',
    title: 'Format Template Laporan Harian Tim',
    content: `Laporan Harian — [Nama Lengkap]
• Selesai hari ini: Integrasi sinkronisasi teks real-time antar perangkat
• Sedang dikerjakan: Pengujian salin satu-klik di browser mobile & desktop
• Kendala: Tidak ada`,
    userName: 'Nadia Putri',
    clientId: 'seed-user-2',
    clipId: 'clip-link-3',
    createdAt: Date.now() - 1000 * 60 * 3,
  },
];

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadClipsFromDisk(): SharedClip[] {
  try {
    ensureDataDir();
    if (fs.existsSync(CLIPS_FILE)) {
      const raw = fs.readFileSync(CLIPS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (err) {
    console.error('Failed to read clips from disk, using initial seed:', err);
  }
  saveClipsToDisk(INITIAL_CLIPS);
  return [...INITIAL_CLIPS];
}

function saveClipsToDisk(clipsToSave: SharedClip[]): void {
  try {
    ensureDataDir();
    fs.writeFileSync(CLIPS_FILE, JSON.stringify(clipsToSave, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save clips to disk:', err);
  }
}

function loadHistoryFromDisk(): TextHistoryEntry[] {
  try {
    ensureDataDir();
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = fs.readFileSync(HISTORY_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (err) {
    console.error('Failed to read history from disk, using initial seed:', err);
  }
  saveHistoryToDisk(INITIAL_HISTORY);
  return [...INITIAL_HISTORY];
}

function saveHistoryToDisk(historyToSave: TextHistoryEntry[]): void {
  try {
    ensureDataDir();
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(historyToSave, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save history to disk:', err);
  }
}

let clips: SharedClip[] = loadClipsFromDisk();
let historyEntries: TextHistoryEntry[] = loadHistoryFromDisk();

interface ClientSession {
  ws: WebSocket;
  clientId: string;
  name: string;
  isTyping: boolean;
  activeClipId: string | null;
  cursorOffset: number | null;
  joinedAt: number;
}

const sessions = new Map<WebSocket, ClientSession>();

function getConnectedUsers(): ConnectedUser[] {
  const byClientId = new Map<string, ConnectedUser>();
  for (const session of sessions.values()) {
    if (session.ws.readyState === WebSocket.OPEN) {
      byClientId.set(session.clientId, {
        clientId: session.clientId,
        name: session.name,
        isTyping: session.isTyping,
        activeClipId: session.activeClipId,
        cursorOffset: session.cursorOffset,
        joinedAt: session.joinedAt,
      });
    }
  }
  return Array.from(byClientId.values());
}

function broadcast(event: ServerEvent): void {
  const payload = JSON.stringify(event);
  for (const session of sessions.values()) {
    if (session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(payload);
    }
  }
}

function sanitizeCategory(cat: unknown): ClipCategory {
  if (cat === 'kode' || cat === 'tautan' || cat === 'umum') {
    return cat;
  }
  return 'umum';
}

function sanitizeHistoryAction(action: unknown): HistoryActionType {
  if (
    action === 'ditempel' ||
    action === 'disalin' ||
    action === 'ditambahkan' ||
    action === 'diedit'
  ) {
    return action;
  }
  return 'ditempel';
}

function recordHistoryEntry(input: {
  id?: string;
  action: HistoryActionType;
  title?: string;
  content: string;
  userName?: string;
  clientId?: string;
  clipId?: string;
  createdAt?: number;
}): TextHistoryEntry | null {
  const trimmed = (input.content || '').trim();
  if (!trimmed) return null;

  const entryId =
    input.id && typeof input.id === 'string' && input.id.trim().length > 0
      ? input.id.trim()
      : `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const existing = historyEntries.find((h) => h.id === entryId);
  if (existing) return existing;

  // Deduplicate rapid identical history logs within 2 seconds from the same user & action
  const now = input.createdAt || Date.now();
  const recentDuplicate = historyEntries.find(
    (h) =>
      h.action === input.action &&
      h.clientId === (input.clientId || 'anon') &&
      h.content === trimmed &&
      Math.abs(now - h.createdAt) < 2000
  );
  if (recentDuplicate) return recentDuplicate;

  const firstLine = trimmed.split('\n')[0].trim().slice(0, 65);
  const cleanTitle = (input.title || '').trim() || firstLine || 'Teks Tanpa Judul';

  const newEntry: TextHistoryEntry = {
    id: entryId,
    action: sanitizeHistoryAction(input.action),
    title: cleanTitle.slice(0, 120),
    content: trimmed.slice(0, 50000),
    userName: (input.userName || 'Anonim').trim().slice(0, 40),
    clientId: (input.clientId || 'anon').slice(0, 64),
    clipId: input.clipId,
    createdAt: now,
  };

  historyEntries = [newEntry, ...historyEntries].slice(0, 400);
  saveHistoryToDisk(historyEntries);
  broadcast({ type: 'history:created', entry: newEntry });
  return newEntry;
}

function createOrGetClip(input: {
  id?: string;
  title?: string;
  content: string;
  author?: string;
  authorId?: string;
  category?: ClipCategory;
}): SharedClip | null {
  const trimmedContent = (input.content || '').trim();
  if (!trimmedContent) return null;

  const clipId =
    input.id && typeof input.id === 'string' && input.id.trim().length > 0
      ? input.id.trim()
      : `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const existing = clips.find((c) => c.id === clipId);
  if (existing) {
    return existing;
  }

  const firstLine = trimmedContent.split('\n')[0].trim().slice(0, 65);
  const cleanTitle = (input.title || '').trim() || firstLine || 'Teks Tanpa Judul';
  const cleanAuthor = (input.author || '').trim().slice(0, 40) || 'Anonim';
  const now = Date.now();

  const newClip: SharedClip = {
    id: clipId,
    title: cleanTitle.slice(0, 120),
    content: trimmedContent.slice(0, 50000),
    author: cleanAuthor,
    authorId: (input.authorId || 'anon').slice(0, 64),
    lastEditor: cleanAuthor,
    category: sanitizeCategory(input.category),
    pinned: false,
    copyCount: 0,
    createdAt: now,
    updatedAt: now,
    revisions: [],
  };

  clips = [newClip, ...clips].slice(0, 250);
  saveClipsToDisk(clips);
  broadcast({ type: 'clip:created', clip: newClip });

  // Also record in history as added/pasted text
  recordHistoryEntry({
    action: 'ditambahkan',
    title: newClip.title,
    content: newClip.content,
    userName: newClip.author,
    clientId: newClip.authorId,
    clipId: newClip.id,
    createdAt: now,
  });

  return newClip;
}

// Track last revision snapshot timestamp per clip so we don't flood revisions on every keystroke
const lastRevisionSavedAt = new Map<string, number>();

function applyLiveEditToClip(input: {
  id: string;
  title?: string;
  content: string;
  category?: ClipCategory;
  editorName: string;
  editorClientId: string;
  saveRevision?: boolean;
}): SharedClip | null {
  const target = clips.find((c) => c.id === input.id);
  if (!target) return null;

  const now = Date.now();
  const previousContent = target.content;
  const previousTitle = target.title;
  const nextContent = typeof input.content === 'string' ? input.content.slice(0, 50000) : target.content;
  const firstLine = nextContent.trim().split('\n')[0]?.trim().slice(0, 65) || 'Teks Kolaborasi';
  const nextTitle =
    input.title !== undefined
      ? input.title.trim().slice(0, 120) || firstLine
      : target.title;

  const lastSaved = lastRevisionSavedAt.get(target.id) || 0;
  const contentDiffersSignificantly =
    Math.abs(nextContent.length - previousContent.length) >= 25 ||
    (input.saveRevision && nextContent !== previousContent);

  if (
    previousContent.trim().length > 0 &&
    nextContent !== previousContent &&
    (input.saveRevision || now - lastSaved > 20000) &&
    contentDiffersSignificantly
  ) {
    const rev = {
      id: `rev-${now}-${Math.random().toString(36).slice(2, 6)}`,
      content: previousContent,
      title: previousTitle,
      editorName: target.lastEditor || target.author,
      timestamp: target.updatedAt,
    };
    target.revisions = [rev, ...(target.revisions || [])].slice(0, 25);
    lastRevisionSavedAt.set(target.id, now);

    // Also record previous snapshot in shared text history
    if (input.saveRevision) {
      recordHistoryEntry({
        action: 'diedit',
        title: nextTitle,
        content: nextContent,
        userName: input.editorName || 'Pengguna',
        clientId: input.editorClientId || 'anon',
        clipId: target.id,
        createdAt: now,
      });
    }
  }

  target.content = nextContent;
  target.title = nextTitle;
  if (input.category) {
    target.category = sanitizeCategory(input.category);
  }
  target.lastEditor = (input.editorName || 'Pengguna').trim().slice(0, 40);
  target.updatedAt = now;

  saveClipsToDisk(clips);
  broadcast({
    type: 'clip:updated',
    clip: target,
    editorClientId: input.editorClientId,
    editorName: target.lastEditor,
  });

  return target;
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      count: clips.length,
      historyCount: historyEntries.length,
      onlineUsers: getConnectedUsers().length,
    });
  });

  app.get('/api/clips', (_req, res) => {
    res.json({
      clips,
      users: getConnectedUsers(),
      history: historyEntries,
    });
  });

  app.post('/api/clips', (req, res) => {
    const { id, title, content, author, authorId, category } = req.body || {};
    if (!content || typeof content !== 'string' || !content.trim()) {
      res.status(400).json({ error: 'Teks tidak boleh kosong.' });
      return;
    }
    const created = createOrGetClip({ id, title, content, author, authorId, category });
    if (!created) {
      res.status(400).json({ error: 'Gagal menambahkan teks.' });
      return;
    }
    res.status(201).json({ clip: created });
  });

  app.patch('/api/clips/:id', (req, res) => {
    const { id } = req.params;
    const { title, content, category, editorName, editorClientId, saveRevision } = req.body || {};
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'Konten teks tidak valid.' });
      return;
    }
    const updated = applyLiveEditToClip({
      id,
      title,
      content,
      category,
      editorName: editorName || 'Pengguna',
      editorClientId: editorClientId || 'anon',
      saveRevision: Boolean(saveRevision),
    });
    if (!updated) {
      res.status(404).json({ error: 'Teks tidak ditemukan.' });
      return;
    }
    res.json({ clip: updated });
  });

  app.post('/api/clips/:id/copy', (req, res) => {
    const { id } = req.params;
    const { userName, clientId } = req.body || {};
    const target = clips.find((c) => c.id === id);
    if (!target) {
      res.status(404).json({ error: 'Teks tidak ditemukan.' });
      return;
    }
    target.copyCount += 1;
    target.updatedAt = Date.now();
    saveClipsToDisk(clips);
    broadcast({ type: 'clip:updated', clip: target });

    recordHistoryEntry({
      action: 'disalin',
      title: target.title,
      content: target.content,
      userName: userName || 'Pengguna',
      clientId: clientId || 'anon',
      clipId: target.id,
    });

    res.json({ clip: target });
  });

  app.patch('/api/clips/:id/pin', (req, res) => {
    const { id } = req.params;
    const target = clips.find((c) => c.id === id);
    if (!target) {
      res.status(404).json({ error: 'Teks tidak ditemukan.' });
      return;
    }
    target.pinned = !target.pinned;
    target.updatedAt = Date.now();
    saveClipsToDisk(clips);
    broadcast({ type: 'clip:updated', clip: target });
    res.json({ clip: target });
  });

  app.delete('/api/clips/:id', (req, res) => {
    const { id } = req.params;
    const exists = clips.some((c) => c.id === id);
    if (exists) {
      clips = clips.filter((c) => c.id !== id);
      saveClipsToDisk(clips);
      broadcast({ type: 'clip:deleted', id });
    }
    res.json({ ok: true, id });
  });

  // History API endpoints
  app.get('/api/history', (_req, res) => {
    res.json({ history: historyEntries });
  });

  app.post('/api/history', (req, res) => {
    const { id, action, title, content, userName, clientId, clipId, createdAt } = req.body || {};
    if (!content || typeof content !== 'string' || !content.trim()) {
      res.status(400).json({ error: 'Konten riwayat kosong.' });
      return;
    }
    const entry = recordHistoryEntry({
      id,
      action: sanitizeHistoryAction(action),
      title,
      content,
      userName,
      clientId,
      clipId,
      createdAt,
    });
    res.status(201).json({ entry });
  });

  app.delete('/api/history/:id', (req, res) => {
    const { id } = req.params;
    historyEntries = historyEntries.filter((h) => h.id !== id);
    saveHistoryToDisk(historyEntries);
    broadcast({ type: 'history:deleted', id });
    res.json({ ok: true, id });
  });

  app.delete('/api/history', (req, res) => {
    const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : undefined;
    if (clientId) {
      historyEntries = historyEntries.filter((h) => h.clientId !== clientId);
    } else {
      historyEntries = [];
    }
    saveHistoryToDisk(historyEntries);
    broadcast({ type: 'history:cleared', clientId });
    res.json({ ok: true });
  });

  // WebSocket Server on /ws
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    const defaultId = `user-${Math.random().toString(36).slice(2, 8)}`;
    const defaultNumber = Math.floor(100 + Math.random() * 900);
    const session: ClientSession = {
      ws,
      clientId: defaultId,
      name: `Pengguna #${defaultNumber}`,
      isTyping: false,
      activeClipId: clips[0]?.id || null,
      cursorOffset: null,
      joinedAt: Date.now(),
    };
    sessions.set(ws, session);

    const initEvent: ServerEvent = {
      type: 'init',
      clips,
      users: getConnectedUsers(),
      history: historyEntries,
    };
    ws.send(JSON.stringify(initEvent));
    broadcast({ type: 'presence:updated', users: getConnectedUsers() });

    ws.on('message', (raw) => {
      try {
        const event = JSON.parse(raw.toString()) as ClientEvent;
        const currentSession = sessions.get(ws);
        if (!currentSession) return;

        switch (event.type) {
          case 'user:identify': {
            if (event.clientId) currentSession.clientId = String(event.clientId).slice(0, 64);
            if (event.name && event.name.trim()) {
              currentSession.name = event.name.trim().slice(0, 40);
            }
            if (event.activeClipId !== undefined) {
              currentSession.activeClipId = event.activeClipId;
            }
            broadcast({ type: 'presence:updated', users: getConnectedUsers() });
            break;
          }
          case 'user:typing': {
            currentSession.isTyping = Boolean(event.isTyping);
            if (event.activeClipId !== undefined) {
              currentSession.activeClipId = event.activeClipId;
            }
            if (event.cursorOffset !== undefined) {
              currentSession.cursorOffset = event.cursorOffset;
            }
            broadcast({ type: 'presence:updated', users: getConnectedUsers() });
            break;
          }
          case 'user:focus_clip': {
            currentSession.activeClipId = event.activeClipId;
            if (event.cursorOffset !== undefined) {
              currentSession.cursorOffset = event.cursorOffset;
            }
            broadcast({ type: 'presence:updated', users: getConnectedUsers() });
            break;
          }
          case 'clip:create': {
            currentSession.isTyping = false;
            const created = createOrGetClip({
              id: event.id,
              title: event.title,
              content: event.content,
              author: event.author || currentSession.name,
              authorId: event.authorId || currentSession.clientId,
              category: event.category,
            });
            if (created) {
              currentSession.activeClipId = created.id;
            }
            broadcast({ type: 'presence:updated', users: getConnectedUsers() });
            break;
          }
          case 'clip:live_edit': {
            currentSession.isTyping = true;
            currentSession.activeClipId = event.id;
            if (event.cursorOffset !== undefined) {
              currentSession.cursorOffset = event.cursorOffset;
            }
            applyLiveEditToClip({
              id: event.id,
              title: event.title,
              content: event.content,
              category: event.category,
              editorName: event.editorName || currentSession.name,
              editorClientId: event.editorClientId || currentSession.clientId,
              saveRevision: event.saveRevision,
            });
            broadcast({ type: 'presence:updated', users: getConnectedUsers() });
            break;
          }
          case 'clip:copy': {
            const target = clips.find((c) => c.id === event.id);
            if (target) {
              target.copyCount += 1;
              target.updatedAt = Date.now();
              saveClipsToDisk(clips);
              broadcast({ type: 'clip:updated', clip: target });

              recordHistoryEntry({
                action: 'disalin',
                title: target.title,
                content: target.content,
                userName: event.userName || currentSession.name,
                clientId: event.clientId || currentSession.clientId,
                clipId: target.id,
              });
            }
            break;
          }
          case 'clip:pin': {
            const target = clips.find((c) => c.id === event.id);
            if (target) {
              target.pinned = !target.pinned;
              target.updatedAt = Date.now();
              saveClipsToDisk(clips);
              broadcast({ type: 'clip:updated', clip: target });
            }
            break;
          }
          case 'clip:delete': {
            const exists = clips.some((c) => c.id === event.id);
            if (exists) {
              clips = clips.filter((c) => c.id !== event.id);
              saveClipsToDisk(clips);
              broadcast({ type: 'clip:deleted', id: event.id });
            }
            break;
          }
          case 'history:record': {
            if (event.entry && event.entry.content) {
              recordHistoryEntry({
                id: event.entry.id,
                action: event.entry.action,
                title: event.entry.title,
                content: event.entry.content,
                userName: event.entry.userName || currentSession.name,
                clientId: event.entry.clientId || currentSession.clientId,
                clipId: event.entry.clipId,
                createdAt: event.entry.createdAt,
              });
            }
            break;
          }
          case 'history:delete': {
            historyEntries = historyEntries.filter((h) => h.id !== event.id);
            saveHistoryToDisk(historyEntries);
            broadcast({ type: 'history:deleted', id: event.id });
            break;
          }
          case 'history:clear': {
            if (event.clientId) {
              historyEntries = historyEntries.filter((h) => h.clientId !== event.clientId);
            } else {
              historyEntries = [];
            }
            saveHistoryToDisk(historyEntries);
            broadcast({ type: 'history:cleared', clientId: event.clientId });
            break;
          }
        }
      } catch (err) {
        console.error('Invalid WebSocket message:', err);
      }
    });

    ws.on('close', () => {
      sessions.delete(ws);
      broadcast({ type: 'presence:updated', users: getConnectedUsers() });
    });

    ws.on('error', () => {
      sessions.delete(ws);
      broadcast({ type: 'presence:updated', users: getConnectedUsers() });
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`TempelSalin real-time server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
