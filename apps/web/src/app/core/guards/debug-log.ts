// TEMPORARY debug overlay - remove after fixing mobile navigation issue
const DEBUG_USERNAME = 'hrka hrka';

const lines: string[] = [];
let overlay: HTMLElement | null = null;
let enabled: boolean | null = null;

export function debugSetUser(username: string): void {
  enabled = username === DEBUG_USERNAME;
  if (!enabled && overlay) {
    overlay.remove();
    overlay = null;
  }
}

function ensureOverlay(): HTMLElement {
  if (overlay && document.body.contains(overlay)) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'debug-nav-overlay';
  overlay.style.cssText = `
    position: fixed; bottom: 0; left: 0; right: 0; max-height: 35vh; overflow-y: auto;
    background: rgba(0,0,0,0.9); color: #0f0; font: 11px/1.4 monospace;
    padding: 8px 10px; z-index: 99999; pointer-events: auto; white-space: pre-wrap;
    word-break: break-all;
  `;
  document.body.appendChild(overlay);
  return overlay;
}

export function debugLog(msg: string): void {
  // Buffer messages before user is known, show them once confirmed
  const ts = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const line = `${ts} ${msg}`;
  lines.push(line);
  if (lines.length > 60) lines.shift();

  if (enabled === false) return;
  if (enabled === null) return; // buffered, will flush when user is set

  const el = ensureOverlay();
  el.textContent = lines.join('\n');
  el.scrollTop = el.scrollHeight;
}

export function debugFlush(): void {
  if (enabled !== true || lines.length === 0) return;
  const el = ensureOverlay();
  el.textContent = lines.join('\n');
  el.scrollTop = el.scrollHeight;
}
