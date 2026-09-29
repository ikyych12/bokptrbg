export type ClipCategory = 'umum' | 'kode' | 'tautan';

export interface SharedClip {
  id: string;
  title: string;
  content: string;
  author: string;
  authorId: string;
  category: ClipCategory;
  pinned: boolean;
  copyCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ConnectedUser {
  clientId: string;
  name: string;
  isTyping: boolean;
  joinedAt: number;
}

export type ServerEvent =
  | { type: 'init'; clips: SharedClip[]; users: ConnectedUser[] }
  | { type: 'clip:created'; clip: SharedClip }
  | { type: 'clip:updated'; clip: SharedClip }
  | { type: 'clip:deleted'; id: string }
  | { type: 'presence:updated'; users: ConnectedUser[] };

export type ClientEvent =
  | { type: 'user:identify'; clientId: string; name: string }
  | { type: 'user:typing'; clientId: string; isTyping: boolean }
  | {
      type: 'clip:create';
      id?: string;
      title: string;
      content: string;
      author: string;
      authorId: string;
      category: ClipCategory;
    }
  | { type: 'clip:copy'; id: string }
  | { type: 'clip:pin'; id: string }
  | { type: 'clip:delete'; id: string };
