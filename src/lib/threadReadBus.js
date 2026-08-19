// src/lib/threadReadBus.js
// Minimal pub/sub, same pattern as chatBus.js: ChatPanel calls notifyThreadRead()
// right after it successfully marks a thread read (see lib/serverApi.js's
// chatReadReceipt), so every unread badge on screen (sidebar count,
// per-thread numbers) can refetch lib/serverApi.js's chatUnreadSummary()
// right away instead of sitting stale until their next poll.
const listeners = new Set();

export function subscribeThreadRead(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function notifyThreadRead(threadId) {
  listeners.forEach((cb) => cb(threadId));
}
