// Garden patio behind the glazing + steel French doors + acid-etched glass.
// The frosted panes show a blurred live capture of the real patio geometry, so what you see through
// the glass matches what is outside when you open the doors.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ROOM } from './room.js';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function rng(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function buildPatio(scene, R) {
  const { HZ, gx, gh, steel } = R, Z0 = HZ + 0.1;          // Z0: outside face of the glazing wall
  const out = new THREE.Group(); out.name = 'patio'; scene.add(out);
  const add = (geo, mat, x, y, z, cast = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; out.add(m); return m; };
  const PX = 3.2, PD = 4.6;                                  // patio half width, depth

  // limestone paving, 0.9 × 0.6 m slabs
  const pave = canvasTex(1024, 1024, (g, W) => {
    const r = rng(41); g.fillStyle = '#C9BFAF'; g.fillRect(0, 0, W, W);
    for (let j = 0; j < 6; j++) for (let i = 0; i < 4; i++) { const v = 196 + r() * 22; g.fillStyle = `rgb(${v},${v - 8},${v - 22})`; g.fillRect(i * 256 + 2, j * 170.7 + 2, 252, 166.7); }
    for (let k = 0; k < 9000; k++) { const v = 150 + r() * 90; g.fillStyle = `rgba(${v},${v - 6},${v - 18},0.25)`; g.fillRect(r() * W, r() * W, 2, 2); }
  });
  pave.repeat.set(2 * PX / 3.6, PD / 3.6);
  const paveM = new THREE.MeshStandardMaterial({ map: pave, roughness: 0.85 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2 * PX, PD), paveM); floor.rotation.x = -Math.PI / 2; floor.position.set(0, -0.005, Z0 + PD / 2); floor.receiveShadow = true; out.add(floor);

  // clipped hedges all round + a low rendered wall with planting in front of the back hedge
  const hedgeT = canvasTex(256, 256, (g, W) => { const r = rng(7); g.fillStyle = '#4F5A3F'; g.fillRect(0, 0, W, W); for (let k = 0; k < 7000; k++) { const v = r(); g.fillStyle = v < 0.5 ? `rgba(40,52,30,0.5)` : `rgba(120,138,92,${0.3 + r() * 0.3})`; g.beginPath(); g.arc(r() * W, r() * W, 1 + r() * 3, 0, 7); g.fill(); } });
  hedgeT.repeat.set(4, 1.4);
  const hedgeM = new THREE.MeshStandardMaterial({ color: '#8C9A78', map: hedgeT, roughness: 0.95 });
  add(new RoundedBoxGeometry(2 * PX + 1.4, 2.6, 0.9, 3, 0.15), hedgeM, 0, 1.3, Z0 + PD + 0.45);
  for (const s of [-1, 1]) add(new RoundedBoxGeometry(0.8, 2.3, PD + 0.4, 3, 0.15), hedgeM, s * (PX + 0.4), 1.15, Z0 + PD / 2 + 0.2);
  const renderM = new THREE.MeshStandardMaterial({ color: '#D9D1C4', roughness: 0.9 });
  add(new THREE.BoxGeometry(2 * PX, 0.48, 0.32), renderM, 0, 0.24, Z0 + PD - 0.16);
  const lowHedge = add(new RoundedBoxGeometry(2 * PX - 0.1, 0.42, 0.3, 3, 0.1), hedgeM, 0, 0.66, Z0 + PD - 0.16);

  // facade above the glazing: slim roof slab with a shadow-casting overhang
  const roof = add(new THREE.BoxGeometry(ROOM.W + 0.6, 0.22, 0.9), renderM, 0, ROOM.H + 0.11, HZ + 0.35);   // hidden from the frost capture (its dark underside would band the transom)

  // two olive trees in large concrete planters
  const planterM = new THREE.MeshStandardMaterial({ color: '#B4AA9A', roughness: 0.85 });
  const barkM = new THREE.MeshStandardMaterial({ color: '#6B5B49', roughness: 0.95 });
  const leafT = canvasTex(256, 256, (g, W) => { const r = rng(17); g.fillStyle = '#7C8868'; g.fillRect(0, 0, W, W); for (let k = 0; k < 5000; k++) { const v = r(); g.fillStyle = v < 0.45 ? 'rgba(52,62,42,0.55)' : v < 0.8 ? 'rgba(150,162,128,0.5)' : 'rgba(190,196,170,0.45)'; g.save(); g.translate(r() * W, r() * W); g.rotate(r() * 6.3); g.fillRect(-1, -4, 2, 8); g.restore(); } });
  leafT.repeat.set(3, 3);
  const leafM = new THREE.MeshStandardMaterial({ color: '#B4BDA2', map: leafT, roughness: 0.92 });
  const glowT = canvasTex(64, 64, (g, W) => { const gr = g.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, W); }, false);
  const uplights = [];
  for (const [x, z, seed] of [[-2.25, Z0 + 2.9, 3], [2.35, Z0 + 3.4, 8]]) {
    const r = rng(seed);
    add(new RoundedBoxGeometry(1.0, 0.62, 1.0, 3, 0.04), planterM, x, 0.31, z);
    const pts = []; for (let k = 0; k <= 5; k++) pts.push(new THREE.Vector3(x + Math.sin(k * 1.3 + seed) * 0.12 * (k / 5), 0.6 + k * 0.42, z + Math.cos(k * 0.9 + seed) * 0.1 * (k / 5)));
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.065, 8), barkM, 0, 0, 0);
    const top = pts[pts.length - 1];
    for (let k = 0; k < 9; k++) {
      let geo = new THREE.IcosahedronGeometry(0.45 + r() * 0.3, 4); geo.deleteAttribute('normal'); geo.deleteAttribute('uv'); geo = mergeVertices(geo); const p = geo.attributes.position;
      const uv = []; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = 1 + 0.12 * Math.sin(x * 9 + seed) * Math.cos(y * 11 + k) + 0.025 * Math.sin(z * 23 + x * 17); p.setXYZ(i, x * n, y * n * 0.72, z * n); uv.push(Math.atan2(z, x) / 3.1416 + 0.5, y + 0.5); }
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.computeVertexNormals();
      add(geo, leafM, top.x + (r() - 0.5) * 1.3, top.y - 0.15 + (r() - 0.3) * 0.7, top.z + (r() - 0.5) * 1.1);
    }
    const up = new THREE.Mesh(new THREE.CircleGeometry(0.04, 20), new THREE.MeshBasicMaterial({ color: '#FFE0B0' })); up.rotation.x = -Math.PI / 2; up.position.set(x + 0.3, 0.625, z - 0.3); out.add(up); uplights.push(up);
    // the beam it throws up the trunk into the canopy (additive glow, night only)
    const gm = new THREE.SpriteMaterial({ map: glowT, color: '#FFD9A0', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const [gy, sc] of [[1.3, 1.1], [top.y - 0.35, 2.2]]) { const sp = new THREE.Sprite(gm); sp.position.set(x + 0.1, gy, z); sp.scale.set(sc, sc, 1); out.add(sp); }
    up.userData.glow = gm;
  }

  // outdoor lounge: two teak lounge chairs, travertine table
  const teak = new THREE.MeshStandardMaterial({ color: '#8A6744', roughness: 0.7 }), cushion = new THREE.MeshStandardMaterial({ color: '#DCD6CB', roughness: 1 });
  for (const [x, z, ry] of [[-0.7, Z0 + 2.3, 0.35], [0.75, Z0 + 2.2, -0.4]]) {
    const c = new THREE.Group(); c.position.set(x, 0, z); c.rotation.y = Math.PI + ry; out.add(c);
    const b = (w, h, d, m, px, py, pz, rx = 0) => { const o = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(w, h, d) * 0.3), m); o.position.set(px, py, pz); o.rotation.x = rx; o.castShadow = o.receiveShadow = true; c.add(o); };
    b(0.72, 0.05, 0.78, teak, 0, 0.26, 0); for (const sx of [-1, 1]) for (const sz of [-1, 1]) b(0.05, 0.26, 0.05, teak, sx * 0.32, 0.13, sz * 0.34);
    b(0.66, 0.1, 0.72, cushion, 0, 0.33, 0.02); b(0.66, 0.55, 0.12, cushion, 0, 0.58, -0.36, -0.22);
    for (const sx of [-1, 1]) b(0.06, 0.05, 0.74, teak, sx * 0.36, 0.52, 0);
  }
  add(new THREE.CylinderGeometry(0.32, 0.3, 0.36, 48), new THREE.MeshStandardMaterial({ color: '#D8CBB5', roughness: 0.6 }), 0.05, 0.18, Z0 + 2.9);

  // one draw call per material for all the static patio geometry (keeps the Quest's draw-call budget)
  out.updateMatrixWorld(true);
  const byMat = new Map(), drop = [];
  out.traverse(o => { if (!o.isMesh || o === roof || o.material.isMeshBasicMaterial) return; const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); g.applyMatrix4(o.matrixWorld); if (!byMat.has(o.material)) byMat.set(o.material, []); byMat.get(o.material).push(g); drop.push(o); });
  for (const o of drop) o.parent.remove(o);
  for (const [mat, list] of byMat) { const m = new THREE.Mesh(mergeGeometries(list), mat); m.castShadow = m.receiveShadow = true; out.add(m); }
  for (const c of [...out.children]) if (c.isGroup && !c.children.length) out.remove(c);

  // sky dome
  const skyM = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: { top: { value: new THREE.Color('#9FB6CC') }, hor: { value: new THREE.Color('#EEF0EC') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 hor; varying vec3 vP; void main(){ float h = clamp(vP.y, 0.0, 1.0); gl_FragColor = vec4(mix(hor, top, pow(h, 0.6)), 1.0); }',
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), skyM); sky.position.set(0, 0, HZ); scene.add(sky);

  // ── glazing: fixed sidelights + transom, two door leaves; all share one frosted material
  const frostCanvas = document.createElement('canvas'); frostCanvas.width = 512; frostCanvas.height = Math.round(512 * gh / (2 * gx));
  const fg = frostCanvas.getContext('2d'); fg.fillStyle = '#EDEFEC'; fg.fillRect(0, 0, frostCanvas.width, frostCanvas.height);
  const frostTex = new THREE.CanvasTexture(frostCanvas); frostTex.colorSpace = THREE.SRGBColorSpace;
  const grain = document.createElement('canvas'); grain.width = frostCanvas.width; grain.height = frostCanvas.height;
  { const g = grain.getContext('2d'), r = rng(13); for (let i = 0; i < 22000; i++) { g.fillStyle = `rgba(255,255,255,${r() * 0.07})`; g.fillRect(r() * grain.width, r() * grain.height, 1, 1); } }
  const frostM = new THREE.MeshStandardMaterial({ color: '#000', emissive: new THREE.Color('#FFFFFF'), emissiveMap: frostTex, emissiveIntensity: 1, roughness: 0.15 });
  const outsideM = new THREE.MeshStandardMaterial({ color: '#C9CDCB', roughness: 0.22, metalness: 0.1, emissive: new THREE.Color('#FFE6C8'), emissiveIntensity: 0 });
  const zg = HZ + 0.04;
  // a pane between world x0..x1, y0..y1 at the glazing plane; uv = position in the glazing as seen from inside
  const pane = (x0, x1, y0, y1, origin = new THREE.Vector3()) => {
    // separate vertices per face (shared ones would average the two normals to zero and render black)
    const geo = new THREE.BufferGeometry(), P = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    const pos = P.flatMap(([x, y]) => [x - origin.x, y - origin.y, zg - origin.z]), uv = P.flatMap(([x, y]) => [(gx - x) / (2 * gx), y / gh]);
    geo.setAttribute('position', new THREE.Float32BufferAttribute([...pos, ...pos], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([...uv, ...uv], 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute([...Array(4).fill([0, 0, -1]).flat(), ...Array(4).fill([0, 0, 1]).flat()], 3));
    geo.setIndex([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7]); geo.addGroup(0, 6, 0); geo.addGroup(6, 6, 1);
    return new THREE.Mesh(geo, [frostM, outsideM]);
  };
  const dg = gx / 2, fixed = new THREE.Group(); scene.add(fixed);
  fixed.add(pane(-gx, -dg, 0.04, gh - 0.05), pane(dg, gx, 0.04, gh - 0.05), pane(-dg, dg, 2.2, gh - 0.05));
  // a glossy skin on the room side picks up interior reflections like real glass
  const sheen = new THREE.Mesh(new THREE.PlaneGeometry(2 * gx, gh), new THREE.MeshPhysicalMaterial({ color: '#FFFFFF', roughness: 0.04, transparent: true, opacity: 0.07, depthWrite: false }));
  sheen.position.set(0, gh / 2, HZ + 0.034); sheen.rotation.y = Math.PI;

  const bronze = new THREE.MeshStandardMaterial({ color: '#6E5A43', metalness: 0.9, roughness: 0.28 });
  const doors = [];
  for (const s of [-1, 1]) {                       // s = -1 left leaf (hinge at -dg), +1 right leaf (hinge at +dg)
    const hingeX = s * dg, leaf = new THREE.Group(); leaf.position.set(hingeX, 0, zg); scene.add(leaf);
    const o = new THREE.Vector3(hingeX, 0, zg), xa = Math.min(hingeX, 0), xb = Math.max(hingeX, 0);
    const meshes = [pane(xa + (s < 0 ? 0.025 : 0.012), xb - (s < 0 ? 0.012 : 0.025), 0.06, 2.17, o)];
    const fb = (w, h, x, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), steel); m.position.set(x - hingeX, y, 0); m.castShadow = true; leaf.add(m); meshes.push(m); };
    fb(0.04, 2.13, xa + 0.02, 1.105); fb(0.04, 2.13, xb - 0.02, 1.105); fb(xb - xa, 0.045, (xa + xb) / 2, 0.0625); fb(xb - xa, 0.04, (xa + xb) / 2, 2.155); fb(xb - xa, 0.03, (xa + xb) / 2, 0.92);
    // long pull handles on both faces, at the meeting stiles
        for (const side of [-1, 1]) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.62, 20), bronze); bar.position.set((s < 0 ? xb - 0.07 : xa + 0.07) - hingeX, 1.05, side * 0.075); bar.castShadow = true; leaf.add(bar); meshes.push(bar);
      for (const dy of [-0.24, 0.24]) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 12), bronze); st.rotation.x = Math.PI / 2; st.position.set(bar.position.x, 1.05 + dy, side * 0.05); leaf.add(st); }
    }
    leaf.add(meshes[0]);
    doors.push({ node: leaf, q1: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s * 1.75), meshes, name: s < 0 ? 'Patio door L' : 'Patio door R' });
  }
  scene.add(sheen);

  // ── blurred live capture of the patio for the frosted glass
  const capW = 256, capH = Math.round(capW * gh / (2 * gx));
  const rt = new THREE.WebGLRenderTarget(capW, capH); rt.texture.colorSpace = THREE.SRGBColorSpace;
  const dist = 1.3, cam = new THREE.PerspectiveCamera(2 * Math.atan((gh / 2) / (dist + 0.04)) * 180 / Math.PI, (2 * gx) / gh, dist + 0.06, 80);
  cam.position.set(0, gh / 2, HZ - dist); cam.lookAt(0, gh / 2, HZ + 10);
  const buf = new Uint8Array(capW * capH * 4), small = document.createElement('canvas'); small.width = capW; small.height = capH;
  const sg = small.getContext('2d'), img = sg.createImageData(capW, capH);
  const hasFilter = 'filter' in fg;
  function capture(renderer) {
    const xr = renderer.xr.enabled, prevT = renderer.getRenderTarget();
    const vis = doors.map(d => d.node.visible); doors.forEach(d => (d.node.visible = false)); fixed.visible = false; sheen.visible = false; roof.visible = false;
    renderer.xr.enabled = false; renderer.setRenderTarget(rt); renderer.render(scene, cam); renderer.readRenderTargetPixels(rt, 0, 0, capW, capH, buf);
    renderer.setRenderTarget(prevT); renderer.xr.enabled = xr;
    doors.forEach((d, i) => (d.node.visible = vis[i])); fixed.visible = true; sheen.visible = true; roof.visible = true;
    for (let y = 0; y < capH; y++) img.data.set(buf.subarray((capH - 1 - y) * capW * 4, (capH - y) * capW * 4), y * capW * 4);
    sg.putImageData(img, 0, 0);
    const W = frostCanvas.width, H = frostCanvas.height;
    fg.save(); fg.globalAlpha = 1;
    if (hasFilter) { fg.filter = 'blur(7px)'; fg.drawImage(small, -15, -15, W + 30, H + 30); fg.filter = 'none'; }
    else { const t = document.createElement('canvas'); t.width = 48; t.height = Math.round(48 * H / W); t.getContext('2d').drawImage(small, 0, 0, t.width, t.height); fg.imageSmoothingQuality = 'high'; fg.drawImage(t, 0, 0, W, H); }
    // the etched surface scatters: lift the blacks, add a soft vertical light gradient and the grain
    fg.globalCompositeOperation = 'screen'; const lg = fg.createLinearGradient(0, 0, 0, H); lg.addColorStop(0, 'rgba(70,70,70,1)'); lg.addColorStop(1, 'rgba(30,30,30,1)'); fg.fillStyle = lg; fg.fillRect(0, 0, W, H);
    fg.globalCompositeOperation = 'source-over'; fg.drawImage(grain, 0, 0); fg.restore();
    frostTex.needsUpdate = true;
  }

  return { out, sky: skyM, doors, frostM, outsideM, capture, frostCanvas, small, uplights, PX, PD, Z0, dg };
}
