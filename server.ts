import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { SharedClip, ConnectedUser, ClientEvent, ServerEvent, ClipCategory } from './src/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'shared-clips.json');

const INITIAL_CLIPS: SharedClip[] = [
  {
    id: 'clip-welcome-1',
    title: 'Panduan Singkat Papan Klip Real-Time',
    content:
      'Selamat datang di TempelSalin! Tempelkan teks, catatan rapat, atau potongan kode di kolom atas lalu klik "Tambahkan". Semua pengguna yang membuka halaman ini akan langsung melihat teks tersebut secara real-time dan dapat menyalinnya hanya dengan satu klik.',
    author: 'Sistem',
    authorId: 'system-seed',
    category: 'umum',
    pinned: true,
    copyCount: 14,
    createdAt: Date.now() - 1000 * 60 * 25,
    updatedAt: Date.now() - 1000 * 60 * 25,
  },
  {
    id: 'clip-code-2',
    title: 'Perintah Deploy & Cek Status Container',
    content: `docker compose pull && docker compose up -d --build
docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"
curl -I http://localhost:3000/api/health`,
    author: 'Raka Wijaya',
    authorId: 'seed-user-1',
    category: 'kode',
    pinned: false,
    copyCount: 8,
    createdAt: Date.now() - 1000 * 60 * 12,
    updatedAt: Date.now() - 1000 * 60 * 12,
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
    category: 'tautan',
    pinned: false,
    copyCount: 5,
    createdAt: Date.now() - 1000 * 60 * 4,
    updatedAt: Date.now() - 1000 * 60 * 4,
  },
];

function loadClipsFromDisk(): SharedClip[] {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
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
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(clipsToSave, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save clips to disk:', err);
  }
}

let clips: SharedClip[] = loadClipsFromDisk();

interface ClientSession {
  ws: WebSocket;
  clientId: string;
  name: string;
  isTyping: boolean;
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

  // Idempotency check
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
    category: sanitizeCategory(input.category),
    pinned: false,
    copyCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  clips = [newClip, ...clips].slice(0, 250);
  saveClipsToDisk(clips);
  broadcast({ type: 'clip:created', clip: newClip });
  return newClip;
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);

  app.use(express.json({ limit: '1mb' }));

  // Health & API routes
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', count: clips.length, onlineUsers: getConnectedUsers().length });
  });

  app.get('/api/clips', (_req, res) => {
    res.json({ clips, users: getConnectedUsers() });
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

  app.post('/api/clips/:id/copy', (req, res) => {
    const { id } = req.params;
    const target = clips.find((c) => c.id === id);
    if (!target) {
      res.status(404).json({ error: 'Teks tidak ditemukan.' });
      return;
    }
    target.copyCount += 1;
    target.updatedAt = Date.now();
    saveClipsToDisk(clips);
    broadcast({ type: 'clip:updated', clip: target });
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
      joinedAt: Date.now(),
    };
    sessions.set(ws, session);

    // Send authoritative state immediately
    const initEvent: ServerEvent = {
      type: 'init',
      clips,
      users: getConnectedUsers(),
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
            broadcast({ type: 'presence:updated', users: getConnectedUsers() });
            break;
          }
          case 'user:typing': {
            currentSession.isTyping = Boolean(event.isTyping);
            broadcast({ type: 'presence:updated', users: getConnectedUsers() });
            break;
          }
          case 'clip:create': {
            currentSession.isTyping = false;
            createOrGetClip({
              id: event.id,
              title: event.title,
              content: event.content,
              author: event.author || currentSession.name,
              authorId: event.authorId || currentSession.clientId,
              category: event.category,
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
