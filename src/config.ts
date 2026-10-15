/** Global engine constants. The world is authored at 480×270 and rendered at integer zoom. */
export const VIEW_W = 480;
export const VIEW_H = 270;
/**
 * Integer render zoom (2–4), picked from the screen size so small laptops render fewer
 * pixels and big screens stay crisp. Override with ?zoom=2|3|4.
 */
function pickZoom(): number {
  if (typeof window === 'undefined') return 4;
  const q = Number(new URLSearchParams(window.location.search).get('zoom'));
  if (q >= 2 && q <= 4) return Math.floor(q);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const sw = Math.max(window.screen?.width || 0, window.screen?.height || 0) || window.innerWidth;
  const sh = Math.min(window.screen?.width || 0, window.screen?.height || 0) || window.innerHeight;
  const fit = Math.min((sw * dpr) / 480, (sh * dpr) / 270);
  // phones and tablets: cap at ×3 to keep the frame rate up
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return Math.max(2, Math.min(touch ? 3 : 4, Math.floor(fit)));
}
export const ZOOM = pickZoom();
export const GAME_W = VIEW_W * ZOOM; // 1920
export const GAME_H = VIEW_H * ZOOM; // 1080
/** UI is laid out in 960×540 units and rendered at 2× for crisp Cyrillic text. */
export const UI_W = 960;
export const UI_H = 540;
export const UI_ZOOM = GAME_W / UI_W;
export const GROUND_Y = 238;
export const SAVE_VERSION = 1;
export const FONT_TITLE = '"Tiny5", "PT Sans", sans-serif';
export const FONT_TEXT = '"PT Sans", "Tiny5", sans-serif';

export const COLORS = {
  panel: 0x10152a,
  panelEdge: 0x2a3456,
  accent: 0xf0a848,
  accentText: '#f6c36a',
  text: '#eef1fb',
  textDim: '#9aa6c8',
  textBad: '#f08a8a',
  textGood: '#9be0a8',
};
