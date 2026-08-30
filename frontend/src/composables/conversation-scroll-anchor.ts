export interface ConversationScrollAnchor {
  conversationId: string;
  offsetTop: number;
  scrollTop: number;
}

const ROW_SELECTOR = '[data-conversation-id]';

function conversationRows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(ROW_SELECTOR));
}

/** Capture the first stable visible row before realtime reorders the list. */
export function captureConversationScrollAnchor(
  container: HTMLElement | null,
  excludedConversationIds: ReadonlySet<string> = new Set(),
): ConversationScrollAnchor | null {
  if (!container || container.scrollTop <= 0) return null;
  const containerRect = container.getBoundingClientRect();
  const row = conversationRows(container).find((candidate) => {
    const conversationId = candidate.dataset.conversationId;
    if (!conversationId || excludedConversationIds.has(conversationId)) return false;
    const rect = candidate.getBoundingClientRect();
    return rect.bottom > containerRect.top && rect.top < containerRect.bottom;
  });
  const conversationId = row?.dataset.conversationId;
  if (!row || !conversationId) return null;
  return {
    conversationId,
    offsetTop: row.getBoundingClientRect().top - containerRect.top,
    scrollTop: container.scrollTop,
  };
}

/** Restore the same row to the same viewport offset after Vue moves another row. */
export function restoreConversationScrollAnchor(
  container: HTMLElement | null,
  anchor: ConversationScrollAnchor | null,
  fallbackIndex = -1,
  estimatedRowHeight = 80,
): void {
  if (!container || !anchor) return;
  const row = conversationRows(container).find(
    (candidate) => candidate.dataset.conversationId === anchor.conversationId,
  );
  if (row) {
    const containerTop = container.getBoundingClientRect().top;
    const currentOffset = row.getBoundingClientRect().top - containerTop;
    container.scrollTop = Math.max(0, anchor.scrollTop + currentOffset - anchor.offsetTop);
    return;
  }
  if (fallbackIndex >= 0) {
    container.scrollTop = Math.max(0, fallbackIndex * estimatedRowHeight - anchor.offsetTop);
  }
}

/** Identify the row that moved furthest toward the top so it is not used as the anchor. */
export function mostUpwardMovedConversationId(
  nextIds: readonly string[],
  previousIds: readonly string[],
): string | null {
  const previousIndex = new Map(previousIds.map((id, index) => [id, index]));
  let movedId: string | null = null;
  let largestMove = 0;
  nextIds.forEach((id, nextIndex) => {
    const oldIndex = previousIndex.get(id);
    // A newly loaded conversation appearing near the top is also an upward move.
    const move = oldIndex == null ? previousIds.length - nextIndex : oldIndex - nextIndex;
    if (move > largestMove) {
      largestMove = move;
      movedId = id;
    }
  });
  return movedId;
}
