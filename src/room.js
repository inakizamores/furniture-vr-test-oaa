// The room: a 7.2 x 6.8 m gallery-living room, one wall per piece, glazed wall with a garden view.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const ROOM = { W: 6.0, D: 5.6, H: 2.9 };          // x, z, y (metres)
const HX = ROOM.W / 2, HZ = ROOM.D / 2;

// ── small procedural texture kit
function rng(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}
function noiseCanvas(w, h, seed, fn) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'), id = g.createImageData(w, h), r = rng(seed);
  for (let i = 0; i < w * h; i++) { const v = fn(i % w, Math.floor(i / w), r); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
  g.putImageData(id, 0, 0); return c;
}
function smoothNoise(w, h, seed, cells) {           // tileable value noise, 0..255
  const r = rng(seed), G = Array.from({ length: cells * cells }, r);
  return (x, y) => {
    const u = x / w * cells, v = y / h * cells, i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    const a = G[(j % cells) * cells + (i % cells)], b = G[(j % cells) * cells + ((i + 1) % cells)], c = G[((j + 1) % cells) * cells + (i % cells)], d = G[((j + 1) % cells) * cells + ((i + 1) % cells)];
    const su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
    return (a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv);
  };
}
function normalFromCanvas(src, strength = 2) {
  const w = src.width, h = src.height, s = src.getContext('2d').getImageData(0, 0, w, h).data;
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'), id = g.createImageData(w, h);
  const H = (x, y) => s[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const nx = (H(x - 1, y) - H(x + 1, y)) * strength, ny = (H(x, y - 1) - H(x, y + 1)) * strength, k = 1 / Math.hypot(nx, ny, 1), o = (y * w + x) * 4;
    id.data[o] = (nx * k * 0.5 + 0.5) * 255; id.data[o + 1] = (ny * k * 0.5 + 0.5) * 255; id.data[o + 2] = (k * 0.5 + 0.5) * 255; id.data[o + 3] = 255;
  }
  g.putImageData(id, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

// wide-plank smoked oak floor, 2.4 m tile
function floorMaterial() {
  const T = 2048, r = rng(33);
  const hc = document.createElement('canvas'); hc.width = hc.height = 1024; const hg = hc.getContext('2d'); hg.fillStyle = '#808080'; hg.fillRect(0, 0, 1024, 1024);
  const map = canvasTex(T, T, (g) => {
    const bw = T / 9;
    for (let b = 0; b < 9; b++) {
      let y = -r() * T;
      while (y < T) {
        const len = T * (0.45 + r() * 0.5), tone = 0.86 + r() * 0.22;
        const base = new THREE.Color('#8A6A4C').multiplyScalar(tone);
        g.fillStyle = '#' + base.getHexString(); g.fillRect(b * bw, y, bw, len);
        for (let k = 0; k < 90; k++) {
          const x0 = b * bw + r() * bw, amp = 1.5 + r() * 5, ph = r() * 6;
          g.strokeStyle = r() < 0.65 ? `rgba(48,30,18,${0.05 + r() * 0.13})` : `rgba(225,195,155,${0.04 + r() * 0.07})`;
          g.lineWidth = 0.7 + r() * 2.2; g.beginPath();
          for (let yy = Math.max(0, y); yy <= Math.min(T, y + len); yy += 20) { const xx = x0 + amp * Math.sin(yy / 230 + ph); yy === Math.max(0, y) ? g.moveTo(xx, yy) : g.lineTo(xx, yy); }
          g.stroke();
        }
        g.fillStyle = 'rgba(25,15,8,0.55)'; g.fillRect(b * bw, y, bw, 2.5);
        hg.fillStyle = '#5a5a5a'; hg.fillRect(b * bw / 2, y / 2, bw / 2, 1.5);
        y += len;
      }
      g.fillStyle = 'rgba(25,15,8,0.6)'; g.fillRect(b * bw, 0, 2.5, T);
      hg.fillStyle = '#5a5a5a'; hg.fillRect(b * bw / 2, 0, 1.5, 1024);
    }
  });
  const nrm = normalFromCanvas(hc, 3);
  const rough = canvasTex(256, 256, (g) => { const r2 = rng(5); g.fillStyle = 'rgb(200,200,200)'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 4000; i++) { const v = 170 + r2() * 60; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(r2() * 256, r2() * 256, 2, 8); } }, false);
  for (const t of [map, nrm]) t.repeat.set(ROOM.W / 2.4, ROOM.D / 2.4);
  rough.repeat.set(8, 8);
  return new THREE.MeshStandardMaterial({ map, normalMap: nrm, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.62, roughnessMap: rough, metalness: 0 });   // satin oiled oak: soft sheen, no glitter
}
// lime plaster, 1.2 m tile
function plasterMaterial(color) {
  const n1 = smoothNoise(512, 512, 7, 8), n2 = smoothNoise(512, 512, 9, 32), n3 = smoothNoise(512, 512, 11, 96);
  const c = noiseCanvas(512, 512, 3, (x, y) => 236 + 9 * (n1(x, y) - 0.5) + 6 * (n2(x, y) - 0.5) + 4 * (n3(x, y) - 0.5));
  const map = new THREE.CanvasTexture(c); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.colorSpace = THREE.SRGBColorSpace;
  const nrm = normalFromCanvas(noiseCanvas(512, 512, 4, (x, y) => 128 + 60 * (n3(x, y) - 0.5) + 40 * (n2(x, y) - 0.5)), 1.2);
  return new THREE.MeshStandardMaterial({ color, map, normalMap: nrm, normalScale: new THREE.Vector2(0.18, 0.18), roughness: 0.94 });
}
function uvBox(geo, scale) {      // planar world-size uvs for a box (scale = metres per texture tile)
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    if (ax > 0.5) uv.setXY(i, p.getZ(i) / scale, p.getY(i) / scale); else if (ay > 0.5) uv.setXY(i, p.getX(i) / scale, p.getZ(i) / scale); else uv.setXY(i, p.getX(i) / scale, p.getY(i) / scale);
  }
  return geo;
}

// ── art
export function artTexture(kind) {
  const r = rng(kind === 'onda' ? 5 : kind === 'arcos' ? 9 : 21);
  return canvasTex(1024, 1024, (g, W, H) => {
    if (kind === 'onda') {          // colour field: burnt sienna over umber
      g.fillStyle = '#C9A77C'; g.fillRect(0, 0, W, H);
      const field = (x0, y0, x1, y1, c, n) => { for (let i = 0; i < n; i++) { g.globalAlpha = 0.05 + r() * 0.08; g.fillStyle = c; g.save(); g.translate(x0 + r() * (x1 - x0), y0 + r() * (y1 - y0)); g.rotate((r() - 0.5) * 0.25); g.fillRect(-60 - r() * 80, -12 - r() * 15, 120 + r() * 160, 24 + r() * 30); g.restore(); } };
      field(80, 70, W - 80, H * 0.58, '#A8492A', 1800); field(100, 110, W - 100, H * 0.52, '#B9582F', 900);
      field(80, H * 0.66, W - 80, H - 70, '#3A2A21', 1600); field(100, H * 0.7, W - 100, H - 100, '#2C211B', 700);
      field(90, H * 0.6, W - 90, H * 0.64, '#D8B98C', 400); g.globalAlpha = 1;
    } else if (kind === 'arcos') {  // ink enso
      g.fillStyle = '#EEE8DC'; g.fillRect(0, 0, W, H);
      const cx = W * 0.5, cy = H * 0.47, R = W * 0.3;
      for (let k = 0; k < 40; k++) {
        const off = (k / 39 - 0.5) * 46; g.strokeStyle = `rgba(22,20,18,${0.35 + r() * 0.5})`; g.lineWidth = 1 + r() * 2; g.beginPath();
        const a0 = -1.9, a1 = a0 + Math.PI * 1.82 - r() * (k % 7 === 0 ? 1.2 : 0.2);
        for (let t = a0; t < a1; t += 0.012) { const w = off * (0.4 + 0.6 * Math.sin((t - a0) / (a1 - a0) * Math.PI)); const rr = R + w + 6 * Math.sin(t * 3); g.lineTo(cx + Math.cos(t) * rr, cy + Math.sin(t) * rr); }
        g.stroke();
      }
      g.fillStyle = '#A8322A'; g.fillRect(W * 0.78, H * 0.8, 46, 46);
    } else {                        // AURA: tonal sound-wave print
      g.fillStyle = '#E9E1D4'; g.fillRect(0, 0, W, H);
      for (let k = 0; k < 64; k++) {
        const y = H * 0.18 + k * (H * 0.64 / 64), amp = 190 * Math.exp(-Math.pow((k - 32) / 13, 2));
        g.strokeStyle = `rgba(${120 + k},${70 + k * 0.6},${45},${0.75 + 0.2 * Math.sin(k / 9)})`; g.lineWidth = 3.4; g.beginPath();
        for (let x = 60; x <= W - 60; x += 6) { const e = Math.sin((x - 60) / (W - 120) * Math.PI); g.lineTo(x, y + amp * e * Math.sin(x / 38 + k * 0.35) * 0.35); }
        g.stroke();
      }
    }
    const id = g.getImageData(0, 0, W, H), d = id.data;
    for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 9; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(id, 0, 0);
  });
}
function textTexture(lines, w = 1024, h = 512) {
  return canvasTex(w, h, (g, W, H) => {
    g.fillStyle = '#F4F0E8'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#1D1B18'; g.textAlign = 'left';
    let y = 120;
    for (const [txt, size, weight, color] of lines) { g.font = `${weight} ${size}px "Helvetica Neue", Arial, sans-serif`; g.fillStyle = color || '#1D1B18'; g.fillText(txt, 70, y); y += size * 1.45; }
  });
}

export function buildRoom(scene) {
  const room = new THREE.Group(); room.name = 'room'; scene.add(room);
  const walls = plasterMaterial('#EFE9E0'), ceilM = new THREE.MeshStandardMaterial({ color: '#F4F1EC', roughness: 0.96, emissive: new THREE.Color('#F4EDE3'), emissiveIntensity: 0.22 }), floorM = floorMaterial();
  const steel = new THREE.MeshStandardMaterial({ color: '#1B1B1C', roughness: 0.45, metalness: 0.7 });
  const brass = new THREE.MeshStandardMaterial({ color: '#B8955E', metalness: 1, roughness: 0.3 });
  const add = (geo, mat, x, y, z, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.receiveShadow = true; m.castShadow = shadow; room.add(m); return m; };
  const box = (w, h, d, mat, x, y, z, tile = 1.2, shadow = true) => add(uvBox(new THREE.BoxGeometry(w, h, d), tile), mat, x, y, z, shadow);

  // floor + ceiling
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.W, ROOM.D), floorM); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; room.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.W, ROOM.D), ceilM); ceil.rotation.x = Math.PI / 2; ceil.position.y = ROOM.H; room.add(ceil);
  // walls (0.2 thick), back / left / right solid; front glazed between x = -2.3 .. 2.3, y = 0 .. 2.75
  const T = 0.2;
  box(ROOM.W + 2 * T, ROOM.H, T, walls, 0, ROOM.H / 2, -HZ - T / 2);
  box(T, ROOM.H, ROOM.D, walls, -HX - T / 2, ROOM.H / 2, 0);
  box(T, ROOM.H, ROOM.D, walls, HX + T / 2, ROOM.H / 2, 0);
  const gx = 1.9, gh = 2.5;
  box(HX - gx, ROOM.H, T, walls, -(HX + gx) / 2, ROOM.H / 2, HZ + T / 2);
  box(HX - gx, ROOM.H, T, walls, (HX + gx) / 2, ROOM.H / 2, HZ + T / 2);
  box(2 * gx, ROOM.H - gh, T, walls, 0, (ROOM.H + gh) / 2, HZ + T / 2);
  // shadow-gap skirting (dark recessed line) around the solid walls
  const gap = new THREE.MeshStandardMaterial({ color: '#2A2724', roughness: 0.9 });
  box(ROOM.W, 0.018, 0.012, gap, 0, 0.009, -HZ + 0.006, 1, false); box(0.012, 0.018, ROOM.D, gap, -HX + 0.006, 0.009, 0, 1, false); box(0.012, 0.018, ROOM.D, gap, HX - 0.006, 0.009, 0, 1, false);
  // steel glazing: mullions every 1.15 m, transom at 2.2
  for (let i = 0; i <= 4; i++) box(0.05, gh, 0.08, steel, -gx + i * (2 * gx / 4), gh / 2, HZ + 0.02, 1);
  box(2 * gx, 0.05, 0.08, steel, 0, gh - 0.025, HZ + 0.02, 1); box(2 * gx, 0.05, 0.08, steel, 0, 2.2, HZ + 0.02, 1); box(2 * gx, 0.04, 0.08, steel, 0, 0.02, HZ + 0.02, 1);
  // acid-etched (frosted) glazing: soft daylight with the blurred shapes of a garden behind it, no sharp view to fake
  const frostMap = canvasTex(1024, 672, (g, W, H) => {
    const r2 = rng(13);
    const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#FFFFFF'); sky.addColorStop(0.55, '#F3F3EF'); sky.addColorStop(1, '#DCDDD4');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    const blob = (x, y, r, c, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${c},${a})`); gr.addColorStop(1, `rgba(${c},0)`); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); };
    for (let i = 0; i < 70; i++) blob(r2() * W, H * (0.42 + r2() * 0.5), 60 + r2() * 110, '120,128,104', 0.10 + r2() * 0.1);   // hedges / shrubs
    for (const tx of [0.12, 0.83]) { for (let i = 0; i < 26; i++) blob(W * tx + (r2() - 0.5) * 220, H * (0.12 + r2() * 0.45), 50 + r2() * 90, '110,118,96', 0.08 + r2() * 0.08); blob(W * tx, H * 0.75, 30, '90,84,74', 0.25); } // two trees
    const ter = g.createLinearGradient(0, H * 0.86, 0, H); ter.addColorStop(0, 'rgba(170,160,145,0)'); ter.addColorStop(1, 'rgba(170,160,145,0.35)'); g.fillStyle = ter; g.fillRect(0, H * 0.86, W, H * 0.14);
    for (let i = 0; i < 90000; i++) { const v = r2() * 18; g.fillStyle = `rgba(255,255,255,${v / 255})`; g.fillRect(r2() * W, r2() * H, 1.2, 1.2); }   // etched grain
  });
  frostMap.wrapS = frostMap.wrapT = THREE.ClampToEdgeWrapping;
  const glassM = new THREE.MeshStandardMaterial({ color: '#000000', emissive: new THREE.Color('#F1F2F0'), emissiveMap: frostMap, emissiveIntensity: 1.0, roughness: 0.2, metalness: 0 });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(2 * gx, gh), glassM);
  glass.position.set(0, gh / 2, HZ + 0.04); glass.rotation.y = Math.PI; room.add(glass);
  // a faint glossy sheet in front of the etched face: picks up room reflections like real glass
  const sheen = new THREE.Mesh(new THREE.PlaneGeometry(2 * gx, gh), new THREE.MeshPhysicalMaterial({ color: '#FFFFFF', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.08, envMapIntensity: 1.5, depthWrite: false }));
  sheen.position.set(0, gh / 2, HZ + 0.036); sheen.rotation.y = Math.PI; room.add(sheen);
  // deep plaster reveals + a limestone threshold
  const stoneM = new THREE.MeshStandardMaterial({ color: '#CFC6B8', roughness: 0.55 });
  box(2 * gx + 0.04, 0.02, 0.12, stoneM, 0, 0.01, HZ + 0.0, 1, false);
  // ceiling: perimeter cove light (emissive strip) + three track spots
  const cove = new THREE.MeshStandardMaterial({ color: '#000', emissive: new THREE.Color('#FFD8A8'), emissiveIntensity: 0.8 });
  for (const [w, d, x, z] of [[ROOM.W - 0.3, 0.04, 0, -HZ + 0.15], [0.04, ROOM.D - 0.3, -HX + 0.15, 0], [0.04, ROOM.D - 0.3, HX - 0.15, 0]]) box(w, 0.01, d, cove, x, ROOM.H - 0.005, z, 1, false);
  // soft corner shading where walls meet the floor / ceiling (cheap ambient occlusion)
  const aoTex = canvasTex(8, 256, (g, W, H) => { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); }, false);
  const aoM = new THREE.MeshBasicMaterial({ color: '#000', alphaMap: aoTex, transparent: true, opacity: 0.22, depthWrite: false });
  const aoC = new THREE.MeshBasicMaterial({ color: '#000', alphaMap: aoTex, transparent: true, opacity: 0.1, depthWrite: false });
  const strip = (len, h, mat, pos, rot) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(len, h), mat); m.position.copy(pos); m.rotation.copy(rot); m.renderOrder = 2; room.add(m); };
  for (const [len, pos, ry] of [[ROOM.W, new THREE.Vector3(0, 0, -HZ + 0.002), 0], [ROOM.D, new THREE.Vector3(-HX + 0.002, 0, 0), Math.PI / 2], [ROOM.D, new THREE.Vector3(HX - 0.002, 0, 0), -Math.PI / 2]]) {
    strip(len, 0.45, aoM, pos.clone().setY(0.225), new THREE.Euler(Math.PI, ry, 0));                    // on the wall, dark at the floor
    strip(len, 0.3, aoC, pos.clone().setY(ROOM.H - 0.15), new THREE.Euler(0, ry, 0));                   // on the wall, dark at the ceiling
    const f = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.4), aoM); f.renderOrder = 2;                   // on the floor, dark at the wall
    f.rotation.set(-Math.PI / 2, 0, ry); f.position.copy(pos).add(new THREE.Vector3(Math.sin(ry) * 0.2, 0.003, Math.cos(ry) * 0.2)); room.add(f);
  }
  // outside: terrace + garden + sky dome
  // sheer linen curtains on a ceiling track, gathered at both ends of the glazing
  const sheerTex = canvasTex(256, 256, (g, W) => { const r2 = rng(23); g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, W, W); for (let i = 0; i < W; i += 2) { g.fillStyle = `rgba(200,190,175,${0.05 + r2() * 0.06})`; g.fillRect(i, 0, 1, W); } });
  sheerTex.repeat.set(6, 4);
  const sheerM = new THREE.MeshStandardMaterial({ color: '#F4EFE6', map: sheerTex, roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0.86, emissive: new THREE.Color('#FFF3E2'), emissiveIntensity: 0.25 });
  const curtain = (width, height, folds, seed) => {
    const geo = new THREE.PlaneGeometry(width, height, Math.max(24, folds * 10), 10), p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const t = (p.getX(i) + width / 2) / width, y = p.getY(i); p.setZ(i, 0.045 * Math.sin(t * folds * Math.PI * 2 + seed) + 0.012 * Math.sin(t * folds * 5.3 + seed * 2) * (0.5 - y / height)); }
    geo.computeVertexNormals(); const m = new THREE.Mesh(geo, sheerM); m.receiveShadow = true; return m;
  };
  box(2 * gx + 0.7, 0.025, 0.04, steel, 0, ROOM.H - 0.03, HZ - 0.14, 1, false);
  for (const [x, w, sd] of [[-gx + 0.32, 0.95, 0.3], [gx - 0.32, 0.95, 1.7]]) { const c = curtain(w, ROOM.H - 0.06, 6, sd); c.position.set(x, (ROOM.H - 0.06) / 2 + 0.01, HZ - 0.14); c.rotation.y = Math.PI; room.add(c); }
  const sky = { material: { uniforms: { top: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3() }, sunCol: { value: new THREE.Color() } } } };

  // rug + reading corner by the window: lounge chair, side table, floor lamp
  const rugMap = canvasTex(512, 512, (g, W) => { g.fillStyle = '#CFC4B2'; g.fillRect(0, 0, W, W); const r2 = rng(9); for (let i = 0; i < 9000; i++) { const v = 180 + r2() * 50; g.fillStyle = `rgba(${v},${v - 8},${v - 20},0.5)`; g.fillRect(r2() * W, r2() * W, 2, 2); } });
  rugMap.repeat.set(3, 2);
  const rugM = new THREE.MeshStandardMaterial({ color: '#C7BAA6', map: rugMap, roughness: 1 });
  add(new RoundedBoxGeometry(2.7, 0.012, 1.9, 2, 0.006), new THREE.MeshStandardMaterial({ color: '#8C7B66', map: rugMap, roughness: 1 }), 0, 0.006, 0.55, false);
  add(new RoundedBoxGeometry(2.5, 0.014, 1.7, 2, 0.006), rugM, 0, 0.007, 0.55, false);
  const boucle = new THREE.MeshStandardMaterial({ color: '#E4DCCD', map: rugMap, roughness: 1 });
  const walnut = new THREE.MeshStandardMaterial({ color: '#5B3F2C', roughness: 0.5 });
  const chair = new THREE.Group();
  const rb = (w, h, d, rr, m, x, y, z) => { const o = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 5, rr), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; chair.add(o); return o; };
  rb(0.76, 0.04, 0.74, 0.006, walnut, 0, 0.02, -0.01); rb(0.86, 0.26, 0.86, 0.06, boucle, 0, 0.17, 0);
  rb(0.15, 0.6, 0.86, 0.07, boucle, -0.355, 0.34, 0); rb(0.15, 0.6, 0.86, 0.07, boucle, 0.355, 0.34, 0);
  rb(0.86, 0.74, 0.17, 0.07, boucle, 0, 0.41, -0.345); rb(0.565, 0.15, 0.7, 0.055, boucle, 0, 0.37, 0.07);
  const bc = rb(0.56, 0.4, 0.17, 0.075, boucle, 0, 0.635, -0.225); bc.rotation.x = -0.17;
  chair.position.set(-2.0, 0, 1.85); chair.rotation.y = Math.PI * 0.8; room.add(chair);
  const side = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.2, 0.48, 48), new THREE.MeshStandardMaterial({ color: '#CFC3AF', roughness: 0.7 }));
  side.position.set(-1.3, 0.24, 2.25); side.castShadow = side.receiveShadow = true; room.add(side);
  const lamp = new THREE.Group();
  const lb = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.175, 0.028, 48), new THREE.MeshStandardMaterial({ color: '#2B2826', roughness: 0.3 })); lb.position.y = 0.014; lamp.add(lb);
  const ls = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 1.42, 16), brass); ls.position.y = 0.74; lamp.add(ls);
  const shadeM = new THREE.MeshStandardMaterial({ color: '#F1E7D6', roughness: 0.95, side: THREE.DoubleSide, emissive: new THREE.Color('#FFC98A'), emissiveIntensity: 0.4 });
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.24, 0.33, 48, 1, true), shadeM); shade.position.y = 1.56; lamp.add(shade);
  const bulb = new THREE.PointLight('#FFC98A', 0, 4, 2); bulb.position.y = 1.5; lamp.add(bulb);
  lamp.position.set(-2.62, 0, 1.2); room.add(lamp);

  room.add(plantInPot(-2.45, -2.15));
  return { room, sky, cove, shadeM, bulb, glass, glassM, sheerM, walls, steel, brass, HX, HZ, gx, gh, ceilM };
}

// picture + picture light + plaque + plinth for one bay (bay frame: origin on the wall at floor, +z into the room)
export function buildBay(bay, kind, info) {
  const g = new THREE.Group();
  const w = kind === 'arcos' ? 0.9 : 1.1, h = kind === 'arcos' ? 0.9 : 0.8, cy = info.artY;
  const frameM = new THREE.MeshStandardMaterial({ color: kind === 'onda' ? '#3B2F26' : kind === 'arcos' ? '#4A3426' : '#C9B79C', roughness: 0.6 });
  const fr = 0.022, dep = 0.045;
  for (const [ww, hh, x, y] of [[w + 2 * fr + 0.03, fr, 0, h / 2 + fr / 2 + 0.015], [w + 2 * fr + 0.03, fr, 0, -h / 2 - fr / 2 - 0.015], [fr, h + 0.03, -w / 2 - fr / 2 - 0.015, 0], [fr, h + 0.03, w / 2 + fr / 2 + 0.015, 0]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(ww, hh, dep), frameM); b.position.set(x, cy + y, dep / 2); b.castShadow = true; g.add(b);
  }
  const back = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.03, h + 0.03), new THREE.MeshStandardMaterial({ color: '#191715', roughness: 1 })); back.position.set(0, cy, 0.004); g.add(back);
  const canvasM = new THREE.MeshStandardMaterial({ map: artTexture(kind), roughness: 0.85 });
  const cv = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.03), [info.edge, info.edge, info.edge, info.edge, canvasM, info.edge]); cv.position.set(0, cy, 0.02); cv.castShadow = true; g.add(cv);
  // brass picture light
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, Math.min(0.62, w * 0.55), 32), info.brass); bar.rotation.z = Math.PI / 2; bar.position.set(0, cy + h / 2 + 0.09, 0.15); g.add(bar);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.15, 12), info.brass); arm.rotation.x = Math.PI / 2; arm.position.set(0, cy + h / 2 + 0.09, 0.075); g.add(arm);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(0.6, w * 0.53), 0.012), new THREE.MeshBasicMaterial({ color: '#FFE6C2' })); glow.rotation.x = Math.PI / 2; glow.position.set(0, cy + h / 2 + 0.073, 0.15); g.add(glow);
  // plaque
  const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.006), [info.edge, info.edge, info.edge, info.edge, new THREE.MeshStandardMaterial({ map: textTexture(info.plaque), roughness: 0.6 }), info.edge]);
  plaque.position.set(info.plaqueX, 1.42, 0.004); g.add(plaque);
  // stone plinth under the piece
  const plinthM = new THREE.MeshStandardMaterial({ color: '#BDB5A8', roughness: 0.6 });
  const plinth = new THREE.Mesh(new RoundedBoxGeometry(info.plinthW, 0.03, info.plinthD, 2, 0.005), plinthM);
  plinth.position.set(0, 0.015, info.plinthD / 2 + 0.01); plinth.receiveShadow = true; g.add(plinth);
  bay.add(g);
  return { plinthTop: 0.03, glow };
}

// soft contact shadow (radial blob) for under furniture
export function contactShadow(w, d) {
  const t = canvasTex(256, 256, (g, W) => { const gr = g.createRadialGradient(W / 2, W / 2, 10, W / 2, W / 2, W / 2); gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.65, 'rgba(0,0,0,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, W); }, false);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0.85 }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 1; return m;
}

// god-ray shafts through the glazing + floating dust
export function lightShafts(scene) {
  const t = canvasTex(128, 256, (g, W, H) => {          // soft on all sides: fades along the beam and towards its edges
    const id = g.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = y / H, u = x / W, along = Math.min(1, v / 0.22) * Math.pow(1 - v, 1.4), across = Math.pow(Math.sin(u * Math.PI), 2.2);
      const a = along * across, o = (y * W + x) * 4; id.data[o] = id.data[o + 1] = id.data[o + 2] = 255; id.data[o + 3] = a * 255;
    }
    g.putImageData(id, 0, 0);
  }, false);
  const mat = new THREE.MeshBasicMaterial({ map: t, color: '#FFE2B8', transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const group = new THREE.Group();
  scene.add(group);
  const N = 500, pos = new Float32Array(N * 3), r = rng(3);
  for (let i = 0; i < N; i++) { pos[i * 3] = (r() - 0.5) * 5; pos[i * 3 + 1] = 0.2 + r() * 2.6; pos[i * 3 + 2] = (r() - 0.5) * 5; }
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dot = canvasTex(32, 32, (g, W) => { const gr = g.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, W); }, false);
  const dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: 0.006, map: dot, transparent: true, opacity: 0.0, color: '#FFF1D8', blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(dust);
  return { group, mat, dust };
}

// olive-like branches in a stone pot, as in the review viewer
function plantInPot(x, z) {
  const g = new THREE.Group(), r = rng(9);
  const potM = new THREE.MeshStandardMaterial({ color: '#B8A994', roughness: 0.85 });
  const prof = [[0, 0], [0.14, 0], [0.2, 0.05], [0.23, 0.17], [0.215, 0.31], [0.13, 0.46], [0.1, 0.53], [0.11, 0.56], [0.095, 0.56], [0, 0.5]];
  const pot = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a, b)), 48), potM); pot.castShadow = pot.receiveShadow = true; g.add(pot);
  const stemM = new THREE.MeshStandardMaterial({ color: '#5B4A3A', roughness: 0.9 }), leafM = new THREE.MeshStandardMaterial({ color: '#6F7A5E', roughness: 0.72, side: THREE.DoubleSide });
  const leafGeo = new THREE.PlaneGeometry(0.016, 0.072, 1, 4);
  { const p = leafGeo.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i) / 0.036; p.setX(i, p.getX(i) * Math.cos(y * 1.45)); p.setZ(i, -0.008 * y * y); } leafGeo.translate(0, 0.036, 0); leafGeo.computeVertexNormals(); }
  const leaves = [], stems = [];
  for (let b = 0; b < 8; b++) {
    const a = (b / 8) * Math.PI * 2 + r(), tilt = 0.12 + r() * 0.35, pts = [];
    for (let k = 0; k <= 6; k++) { const t = k / 6, rr = 0.65 * Math.sin(tilt) * t * (0.6 + r() * 0.5) + t * t * 0.08 * r(); pts.push(new THREE.Vector3(Math.cos(a) * rr, 1.6 * (0.25 + 0.75 * t) * (0.75 + 0.25 * r()), Math.sin(a) * rr)); }
    pts[0].set(0, 0, 0);
    const curve = new THREE.CatmullRomCurve3(pts); stems.push(new THREE.TubeGeometry(curve, 40, 0.0045, 6));
    for (let k = 0; k < 80; k++) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 6.28, r() * 6.28, r() * 6.28)), sc = 0.7 + r() * 0.6;
      leaves.push(leafGeo.clone().applyMatrix4(new THREE.Matrix4().compose(curve.getPoint(0.25 + 0.75 * r()), q, new THREE.Vector3(sc, sc, sc))));
    }
  }
  const merge = (list0) => { const list = list0.map(x => x.index ? x.toNonIndexed() : x); const n = list.reduce((a, x) => a + x.attributes.position.count, 0), pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), idx = []; let o = 0;
    for (const gi of list) { pos.set(gi.attributes.position.array, o * 3); nor.set(gi.attributes.normal.array, o * 3); for (let i = 0; i < gi.attributes.position.count; i++) idx.push(o + i); o += gi.attributes.position.count; }
    const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, o * 3), 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, o * 3), 3)); out.setIndex(idx); return out; };
  const st = new THREE.Mesh(merge(stems), stemM); st.position.y = 0.45; st.castShadow = true; g.add(st);
  const lv = new THREE.Mesh(merge(leaves), leafM); lv.position.y = 0.45; lv.castShadow = true; g.add(lv);
  g.position.set(x, 0, z);
  return g;
}
