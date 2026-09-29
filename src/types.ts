export type ClipCategory = 'umum' | 'kode' | 'tautan';

export interface ClipRevision {
  id: string;
  content: string;
  title: string;
  editorName: string;
  timestamp: number;
}

export interface SharedClip {
  id: string;
  title: string;
  content: string;
  author: string;
  authorId: string;
  lastEditor?: string;
  category: ClipCategory;
  pinned: boolean;
  copyCount: number;
  createdAt: number;
  updatedAt: number;
  revisions?: ClipRevision[];
}

export type HistoryActionType = 'ditempel' | 'disalin' | 'ditambahkan' | 'diedit';

export interface TextHistoryEntry {
  id: string;
  action: HistoryActionType;
  title: string;
  content: string;
  userName: string;
  clientId: string;
  clipId?: string;
  createdAt: number;
}

export interface ConnectedUser {
  clientId: string;
  name: string;
  isTyping: boolean;
  activeClipId: string | null;
  cursorOffset?: number | null;
  joinedAt: number;
}

export type ServerEvent =
  | {
      type: 'init';
      clips: SharedClip[];
      users: ConnectedUser[];
      history: TextHistoryEntry[];
    }
  | { type: 'clip:created'; clip: SharedClip }
  | {
      type: 'clip:updated';
      clip: SharedClip;
      editorClientId?: string;
      editorName?: string;
    }
  | { type: 'clip:deleted'; id: string }
  | { type: 'presence:updated'; users: ConnectedUser[] }
  | { type: 'history:created'; entry: TextHistoryEntry }
  | { type: 'history:deleted'; id: string }
  | { type: 'history:cleared'; clientId?: string };

export type ClientEvent =
  | {
      type: 'user:identify';
      clientId: string;
      name: string;
      activeClipId?: string | null;
    }
  | {
      type: 'user:typing';
      clientId: string;
      isTyping: boolean;
      activeClipId?: string | null;
      cursorOffset?: number | null;
    }
  | {
      type: 'user:focus_clip';
      clientId: string;
      activeClipId: string | null;
      cursorOffset?: number | null;
    }
  | {
      type: 'clip:create';
      id?: string;
      title: string;
      content: string;
      author: string;
      authorId: string;
      category: ClipCategory;
    }
  | {
      type: 'clip:live_edit';
      id: string;
      title: string;
      content: string;
      category: ClipCategory;
      editorName: string;
      editorClientId: string;
      cursorOffset?: number | null;
      saveRevision?: boolean;
    }
  | { type: 'clip:copy'; id: string; userName?: string; clientId?: string }
  | { type: 'clip:pin'; id: string }
  | { type: 'clip:delete'; id: string }
  | {
      type: 'history:record';
      entry: Omit<TextHistoryEntry, 'id' | 'createdAt'> & { id?: string; createdAt?: number };
    }
  | { type: 'history:delete'; id: string }
  | { type: 'history:clear'; clientId?: string };
