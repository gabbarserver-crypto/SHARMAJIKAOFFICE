// src/lib/chatBus.js
// Minimal pub/sub so components far from <ChatWidget/> (e.g. the "New
// Application" flow in DealerPortal) can push a system message into the
// chat panel without lifting all chat state up through props.
const listeners = new Set();

export function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function postChatMessage(text, from = "bot") {
  listeners.forEach((cb) => cb({ from, text }));
}
