// Wall-mounted tablets (iPad-like): black glass slab, thin aluminium edge, canvas UI with hit-testable buttons.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const W = 1180, H = 820;                       // screen pixels (≈ 11" iPad landscape ratio)
const FONT = '"Inter", "Helvetica Neue", Arial, sans-serif';

export class Tablet {
  constructor(title, w = 0.25) {
    this.w = w; this.h = w * H / W;
    this.canvas = document.createElement('canvas'); this.canvas.width = W; this.canvas.height = H;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
    this.title = title; this.items = []; this.hover = null; this.press = null;
    this.group = new THREE.Group();
    const body = new THREE.Mesh(new RoundedBoxGeometry(this.w + 0.016, this.h + 0.016, 0.007, 4, 0.008),
      new THREE.MeshStandardMaterial({ color: '#8E9196', metalness: 0.9, roughness: 0.32 }));
    body.position.z = 0.0035; body.castShadow = true; this.group.add(body);
    const glass = new THREE.Mesh(new RoundedBoxGeometry(this.w + 0.012, this.h + 0.012, 0.002, 4, 0.006),
      new THREE.MeshStandardMaterial({ color: '#050506', roughness: 0.08, metalness: 0.1 }));
    glass.position.z = 0.0075; this.group.add(glass);
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(this.w, this.h),
      new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    this.screen.position.z = 0.0087; this.screen.userData.tablet = this; this.group.add(this.screen);
    // wall mount shadow plate
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(this.w + 0.03, this.h + 0.03), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.12 }));
    plate.position.z = 0.0005; this.group.add(plate);
  }
  // layout helpers (pixel units)
  button(id, x, y, w, h, label, opts = {}) { this.items.push({ type: 'button', id, x, y, w, h, label, ...opts }); }
  slider(id, x, y, w, label, opts = {}) { this.items.push({ type: 'slider', id, x, y, w, h: 70, label, ...opts }); }
  text(fn) { this.items.push({ type: 'custom', draw: fn }); }

  uvToPx(uv) { return [uv.x * W, (1 - uv.y) * H]; }
  hit(uv) {
    const [px, py] = this.uvToPx(uv);
    for (const it of this.items) if (it.type !== 'custom' && px >= it.x && px <= it.x + it.w && py >= it.y - (it.type === 'slider' ? 10 : 0) && py <= it.y + it.h) return { it, px, py };
    return null;
  }
  // pointer: called while a ray/finger is on the screen; returns true if consumed
  pointer(uv, down, state, onAction) {
    const h = uv ? this.hit(uv) : null;
    const hv = h ? h.it.id : null;
    let dirty = hv !== this.hover; this.hover = hv;
    if (h && h.it.type === 'slider' && down) {
      const v = Math.min(1, Math.max(0, (h.px - h.it.x) / h.it.w));
      onAction(h.it.id, v); dirty = true;
    } else if (h && down && !this.press) { this.press = h.it.id; onAction(h.it.id); dirty = true; }
    if (!down && this.press) { this.press = null; dirty = true; }
    if (dirty) this.draw(state);
    return !!h;
  }
  draw(state) {
    const g = this.g;
    const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#16171A'); bg.addColorStop(1, '#0D0E10');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    // status bar
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = `500 22px ${FONT}`; g.textAlign = 'left';
    g.fillText(state.clock || '', 34, 40); g.textAlign = 'right'; g.fillText('●●●  100%', W - 34, 40);
    g.textAlign = 'left'; g.fillStyle = '#F3EFE8'; g.font = `600 46px ${FONT}`; g.fillText(this.title, 48, 112);
    for (const it of this.items) {
      if (it.type === 'custom') { it.draw(g, state, W, H); continue; }
      const hov = this.hover === it.id, prs = this.press === it.id;
      if (it.type === 'button') {
        const on = it.active ? it.active(state) : false;
        g.fillStyle = on ? (it.accent || '#E8C79A') : prs ? '#3A3C42' : hov ? '#2E3036' : '#24262B';
        roundRect(g, it.x, it.y, it.w, it.h, 22); g.fill();
        g.fillStyle = on ? '#1A1714' : '#EDE8E0'; g.font = `${it.small ? 500 : 600} ${it.small ? 26 : 30}px ${FONT}`; g.textAlign = 'center';
        const lab = typeof it.label === 'function' ? it.label(state) : it.label;
        const lines = String(lab).split('\n');
        lines.forEach((l, k) => g.fillText(l, it.x + it.w / 2, it.y + it.h / 2 + 10 + (k - (lines.length - 1) / 2) * 34));
        if (it.sub) { g.font = `400 21px ${FONT}`; g.fillStyle = on ? 'rgba(26,23,20,0.7)' : 'rgba(237,232,224,0.55)'; g.fillText(it.sub(state), it.x + it.w / 2, it.y + it.h - 18); }
      } else {
        const v = it.value(state);
        g.fillStyle = 'rgba(237,232,224,0.7)'; g.font = `500 24px ${FONT}`; g.textAlign = 'left'; g.fillText(it.label, it.x, it.y - 8);
        g.textAlign = 'right'; g.fillText(it.fmt ? it.fmt(state) : Math.round(v * 100) + '%', it.x + it.w, it.y - 8);
        g.fillStyle = '#2A2C31'; roundRect(g, it.x, it.y + 22, it.w, 16, 8); g.fill();
        const grad = g.createLinearGradient(it.x, 0, it.x + it.w, 0);
        (it.gradient || ['#8FA3B8', '#E8C79A']).forEach((c, k, a) => grad.addColorStop(k / (a.length - 1), c));
        g.fillStyle = grad; roundRect(g, it.x, it.y + 22, Math.max(16, it.w * v), 16, 8); g.fill();
        g.fillStyle = '#FFFFFF'; g.beginPath(); g.arc(it.x + it.w * v, it.y + 30, hov ? 22 : 18, 0, 7); g.fill();
      }
    }
    this.tex.needsUpdate = true;
  }
}
export function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
