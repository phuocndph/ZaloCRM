export interface DesktopNotification {
  id: string;
  convId: string;
  name: string;
  context: string;
  at: number;
  count?: number;
}
export interface DesktopState { items: DesktopNotification[]; count: number; signedIn: boolean }
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
}
declare global { interface Window { zaloDesktop?: DesktopBridge } }
export function desktopBridge(): DesktopBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.zaloDesktop;
}
