export interface DesktopNotification {
  id: string;
  convId: string;
  name: string;
  context: string;
  at: number;
  count?: number;
  preview?: string;
  avatarUrl?: string | null;
  redacted?: boolean;
  announce?: boolean;
}
export interface DesktopState { items: DesktopNotification[]; count: number; signedIn: boolean; pinned?: boolean; revision?: number }
export interface DesktopAppInfo { version: string; platform: string; arch: string }
export interface DesktopUpdateStatus { phase: 'downloading' | 'verified' | 'launching' | 'cancelled' | 'failed'; received?: number; total?: number }
export interface DesktopUpdateResult { ok: boolean; cancelled?: boolean; error?: string }
export interface DesktopBridge {
  role: 'main' | 'chat';
  setIdentity(value: { userId: string; orgId: string } | null): void;
  notify(value: DesktopNotification): Promise<boolean>;
  dismiss(id: string): void;
  clear(): void;
  active(id: string): void;
  state(): Promise<DesktopState | null>;
  onState(callback: (state: DesktopState) => void): () => void;
  onOpen(callback: (id: string) => void): () => void;
  onReset(callback: () => void): () => void;
  openMain(id?: string): void;
  hide(): void;
  expand(): void;
  setPinned?(value: boolean): void;
  syncUnread?(counts: Array<{ convId: string; count: number }>, revision: number): Promise<boolean>;
  onSyncRequest?(callback: () => void): () => void;
  appInfo?(): Promise<DesktopAppInfo | null>;
  installUpdate?(release: unknown): Promise<DesktopUpdateResult>;
  onUpdateStatus?(callback: (status: DesktopUpdateStatus) => void): () => void;
}
declare global { interface Window { zaloDesktop?: DesktopBridge } }
export function desktopBridge(): DesktopBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.zaloDesktop;
}
