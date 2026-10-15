// ONDA · ARCOS · AURA - one-room WebXR experience (Meta Quest 3 browser + desktop fallback)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { ROOM, buildRoom, buildBay, contactShadow, lightShafts } from './room.js';
import { Tablet } from './tablet.js';
import { Music, RECORDS } from './music.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const $ = s => document.querySelector(s);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ════════════════════════════════════════════════════════════════════ renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;   // redrawn only when something changes
renderer.xr.enabled = true; renderer.xr.setFoveation(0.5); renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.03, 600);
const rig = new THREE.Group(); rig.add(camera); scene.add(rig);
const START = { pos: V(0, 0, 1.55), yaw: 0 };
rig.position.copy(START.pos); camera.position.set(0, 1.62, 0);
const listener = new THREE.AudioListener(); camera.add(listener);

const R = buildRoom(scene);
const shafts = lightShafts(scene);

// lights
const sun = new THREE.DirectionalLight('#FFF1DC', 3);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 30 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 4;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight('#CFDDF0', '#6B5A48', 0.6); scene.add(hemi);
const spots = {};

// ════════════════════════════════════════════════════════════════════ state
const S = {
  hour: 21.8, hourTarget: 21.8, sunRot: 0.15, gallery: true, dimmer: 0.75, shafts: true, volume: 0.8,
  playing: null, ready: false,
};
const pieces = {};              // key -> piece record
const movers = [], lpUnits = [], loose = [], hitTargets = [], colliders = [];
let music = null;

// ════════════════════════════════════════════════════════════════════ bays (one wall each)
const BAYS = {
  aura: { pos: V(0, 0, -ROOM.D / 2), rot: 0 },
  onda: { pos: V(-ROOM.W / 2, 0, -0.35), rot: Math.PI / 2 },
  arcos: { pos: V(ROOM.W / 2, 0, -0.75), rot: -Math.PI / 2 },
};
const INFO = {
  onda: { name: 'ONDA', plaque: [['ONDA', 46, 700], ['Wave console', 28, 400], ['Smoked oak, carved wave relief', 22, 400, '#6E685F'], ['2260 × 450 × 830 mm', 22, 400, '#6E685F']] },
  arcos: { name: 'ARCOS', plaque: [['ARCOS', 46, 700], ['Arc sideboard', 28, 400], ['Walnut, 3form Koda XT fronts', 22, 400, '#6E685F'], ['1500 × 450 × 840 mm', 22, 400, '#6E685F']] },
  aura: { name: 'AURA', plaque: [['AURA', 46, 700], ['Modular listening console', 28, 400], ['Lacquer, white oak, lit sail', 22, 400, '#6E685F'], ['2500 × 480 × 750 mm', 22, 400, '#6E685F']] },
};

// ════════════════════════════════════════════════════════════════════ loading

// ════════════════════════════════════════════════════════════════════ piece processing
function nameChain(o, stop) { const n = []; for (let p = o; p && p !== stop; p = p.parent) if (p.name) n.push(p.name); return n.join('/'); }
const RX = {
  lp: /jacket|LP_sleeve/i,
  spinner: /Turntable_platter|LP_on_platter|^Platter|^Record$|^Record_label$/i,
  arm: /^Tonearm$|^Tonearm_tube$/i,
  armPivot: /^Tonearm_pivot$|^Tonearm_pillar$/i,
  speaker: /Speaker_[LR]_cabinet|^Soundbar_\(by|^Subwoofer_\(by/i,
  deck: /Turntable|Tonearm|Platter|^Record$|^Record_label$/i,
  glow: /LED|diffuser|glow/i,
};
function ownMatch(o, stop, re) { for (let p = o; p && p !== stop; p = p.parent) if (re.test(p.name || '')) return p; return null; }

function cleanGeo(m, inv) {
  let g = m.geometry.clone();
  for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
  const M = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
  g.applyMatrix4(M);
  if (M.determinant() < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } }
  g.morphAttributes = {};
  return g;
}
function mergeInto(target, meshes, { bvh = false, collide = false, shadow = true } = {}) {
  target.updateMatrixWorld(true);
  const inv = target.matrixWorld.clone().invert(), byMat = new Map();
  for (const m of meshes) { const mat = Array.isArray(m.material) ? m.material[0] : m.material; if (!byMat.has(mat)) byMat.set(mat, []); byMat.get(mat).push(cleanGeo(m, inv)); }
  const out = [];
  for (const [mat, list] of byMat) {
    const geo = mergeGeometries(list); if (!geo) continue;
    const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = shadow && !mat.transparent; mesh.receiveShadow = true;
    if (bvh) geo.computeBoundsTree();
    if (collide) colliders.push(mesh);
    target.add(mesh); out.push(mesh);
  }
  return out;
}
function boxOf(meshes, space) {
  const b = new THREE.Box3(), inv = space.matrixWorld.clone().invert(), tmp = new THREE.Box3();
  for (const m of meshes) { m.geometry.computeBoundingBox(); tmp.copy(m.geometry.boundingBox).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)); b.union(tmp); }
  return b;
}

function setupPiece(key, gltf) {
  const bay = new THREE.Group(); bay.position.copy(BAYS[key].pos); bay.rotation.y = BAYS[key].rot; scene.add(bay);
  const src = gltf.scene; src.updateMatrixWorld(true);
  // normalise: back-centre-bottom of the piece at the origin, front towards +z
  const bb = new THREE.Box3().setFromObject(src), size = bb.getSize(V()), ctr = bb.getCenter(V());
  const holder = new THREE.Group(); holder.name = key; bay.add(holder);
  const inner = new THREE.Group(); holder.add(inner);
  inner.add(src); src.position.set(-ctr.x, -bb.min.y, -bb.min.z);
  const plinthW = size.x + 0.34, plinthD = size.z + 0.28;
  const edge = new THREE.MeshStandardMaterial({ color: '#ECE6DD', roughness: 0.9 });
  const artY = 0.03 + size.y + 0.25 + 0.45;
  const bayParts = buildBay(bay, key, { artY, edge, brass: R.brass, plaque: INFO[key].plaque, plaqueX: size.x / 2 + 0.38, plinthW, plinthD });
  holder.position.set(0, bayParts.plinthTop, 0.04);
  holder.updateMatrixWorld(true);
  const cs = contactShadow(size.x * 1.15, size.z * 1.6); cs.position.set(0, 0.002, size.z / 2); holder.add(cs);

  // gallery spot from the ceiling
  const sp = new THREE.SpotLight('#FFE3BF', 0, 7, 0.42, 0.65, 1.6);
  sp.position.set(0, ROOM.H - 0.05, 1.6); sp.target.position.set(0, size.y * 0.8 + 0.3, 0.1); bay.add(sp, sp.target);
  spots[key] = sp;

  // classify meshes
  const moverNodes = new Map();
  const mo = motions[key] || {};
  src.traverse(o => { const a = gltf.parser.associations.get(o); if (a && a.nodes !== undefined && mo[a.nodes]) moverNodes.set(o, mo[a.nodes]); });
  const ctxOf = o => { for (let p = o; p && p !== src.parent; p = p.parent) if (moverNodes.has(p)) return p; return src; };
  const groups = new Map();      // ctx -> {static:[], lps: Map(unitNode -> meshes)}
  const spin = [], arm = [], armPivot = [], speakers = [], deck = [], glowMeshes = [];
  const all = []; src.traverse(o => { if (o.isMesh) all.push(o); });
  for (const m of all) {
    const ctx = ctxOf(m);
    if (!groups.has(ctx)) groups.set(ctx, { static: [], lps: new Map() });
    const G = groups.get(ctx);
    const lpNode = ownMatch(m, src, RX.lp);
    if (lpNode) { if (!G.lps.has(lpNode)) G.lps.set(lpNode, []); G.lps.get(lpNode).push(m); continue; }
    if (ownMatch(m, src, RX.speaker)) speakers.push(m);
    if (ownMatch(m, src, RX.deck)) deck.push(m);
    if (ownMatch(m, src, RX.spinner)) { spin.push(m); continue; }
    if (ownMatch(m, src, RX.arm)) { arm.push(m); continue; }
    if (ownMatch(m, src, RX.armPivot)) armPivot.push(m);
    if (key === 'aura' && (m.material.emissive && m.material.emissive.getHex() !== 0)) glowMeshes.push(m);
    G.static.push(m);
  }
  const rec = { key, bay, holder, inner, size, movers: [], speakers: [], spinner: null, arm: null, playing: false, glowMats: new Set(glowMeshes.map(m => m.material)) };
  pieces[key] = rec;

  // turntable: spinning platter + record, swinging tonearm, hit box
  src.updateMatrixWorld(true);
  if (spin.length) {
    const b = boxOf(spin, inner), c = b.getCenter(V());
    const piv = new THREE.Group(); piv.position.copy(c); inner.add(piv); piv.updateMatrixWorld(true);
    mergeInto(piv, spin); rec.spinner = piv;
  }
  if (arm.length) {
    const pb = boxOf(armPivot.length ? armPivot : arm, inner), pc = pb.getCenter(V());
    const piv = new THREE.Group(); piv.position.copy(pc); inner.add(piv); piv.updateMatrixWorld(true);
    mergeInto(piv, arm);
    // swing direction: towards the platter centre
    const ac = boxOf(piv.children, inner).getCenter(V()), toArm = ac.clone().sub(pc), toPl = (rec.spinner ? rec.spinner.position : pc).clone().sub(pc);
    rec.arm = piv; rec.armSign = Math.sign(toArm.x * toPl.z - toArm.z * toPl.x) || 1; rec.armAngle = 0;
  }
  if (deck.length) {
    const b = boxOf(deck, inner), box = new THREE.Mesh(new THREE.BoxGeometry(...b.getSize(V()).toArray()), new THREE.MeshBasicMaterial({ visible: false }));
    box.position.copy(b.getCenter(V())); inner.add(box); box.userData.turntable = key; hitTargets.push(box);
  }
  for (const s of speakers) { const b = boxOf([s], inner); rec.speakers.push(b.getCenter(V())); }

  // movers: closed pose from the file, open pose from motions.json
  for (const [node, m] of moverNodes) {
    const mv = { piece: key, node, t: 0, target: 0, p0: node.position.clone(), q0: node.quaternion.clone(), s0: node.scale.clone(),
      p1: V(...m.t), q1: new THREE.Quaternion(...m.r), name: m.name };
    // translation movers that also carry rotation keep their closed orientation
    movers.push(mv); rec.movers.push(mv);
  }
  // merge: statics per context, LP racks per context
  for (const [ctx, G] of groups) {
    const meshes = mergeInto(ctx === src ? inner : ctx, G.static, { bvh: true, collide: ctx === src });
    if (ctx !== src) { const mv = movers.find(x => x.node === ctx); mv.meshes = meshes; for (const mm of meshes) { mm.userData.mover = mv; hitTargets.push(mm); } }
    if (G.lps.size) buildRack(ctx === src ? inner : ctx, G.lps, key);
  }
  // the merged meshes replace the originals; empty groups (and the mover nodes) stay in place
  for (const m of all) m.parent && m.parent.remove(m);
  rec.box = new THREE.Box3().setFromObject(holder);
  addProps(key, rec);
}

// LP racks: every LP of one context merged into one mesh; each LP keeps its vertex/index range so it can be pulled out
function buildRack(ctx, lpMap, key) {
  ctx.updateMatrixWorld(true);
  const inv = ctx.matrixWorld.clone().invert(), geos = [], units = [];
  let v0 = 0, i0 = 0, mat = null;
  for (const [node, meshes] of lpMap) {
    const parts = meshes.map(m => cleanGeo(m, inv)); mat = mat || meshes[0].material;
    const g = parts.length > 1 ? mergeGeometries(parts) : parts[0];
    g.computeBoundingBox();
    units.push({ v0, vc: g.attributes.position.count, i0, ic: g.index.count, box: g.boundingBox.clone(), ctx, key, out: false });
    v0 += g.attributes.position.count; i0 += g.index.count; geos.push(g);
  }
  const geo = mergeGeometries(geos);
  const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = mesh.receiveShadow = true; mesh.userData.rack = true; ctx.add(mesh);
  const orig = geo.attributes.position.array.slice();
  for (const u of units) { u.mesh = mesh; u.orig = orig; u.center = u.box.getCenter(V()); lpUnits.push(u); }
}
function rackHide(u, hide) {
  const pa = u.mesh.geometry.attributes.position, a = pa.array;
  for (let i = u.v0; i < u.v0 + u.vc; i++) {
    if (hide) { a[i * 3] = u.center.x; a[i * 3 + 1] = u.center.y; a[i * 3 + 2] = u.center.z; }
    else { a[i * 3] = u.orig[i * 3]; a[i * 3 + 1] = u.orig[i * 3 + 1]; a[i * 3 + 2] = u.orig[i * 3 + 2]; }
  }
  pa.needsUpdate = true; u.out = hide;
}
function lpMeshFromUnit(u) {
  const g = u.mesh.geometry, ga = g.attributes, idx = g.index.array, c = u.center;
  const pos = new Float32Array(u.vc * 3), nor = new Float32Array(u.vc * 3), uv = new Float32Array(u.vc * 2);
  for (let i = 0; i < u.vc; i++) {
    const s = u.v0 + i;
    pos[i * 3] = u.orig[s * 3] - c.x; pos[i * 3 + 1] = u.orig[s * 3 + 1] - c.y; pos[i * 3 + 2] = u.orig[s * 3 + 2] - c.z;
    nor[i * 3] = ga.normal.array[s * 3]; nor[i * 3 + 1] = ga.normal.array[s * 3 + 1]; nor[i * 3 + 2] = ga.normal.array[s * 3 + 2];
    uv[i * 2] = ga.uv.array[s * 2]; uv[i * 2 + 1] = ga.uv.array[s * 2 + 1];
  }
  const ix = new Uint32Array(u.ic); for (let i = 0; i < u.ic; i++) ix[i] = idx[u.i0 + i] - u.v0;
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(new THREE.BufferAttribute(ix, 1));
  geo.computeBoundingBox();
  const m = new THREE.Mesh(geo, u.mesh.material); m.castShadow = m.receiveShadow = true;
  u.mesh.updateMatrixWorld(true); m.position.copy(c).applyMatrix4(u.mesh.matrixWorld); m.quaternion.setFromRotationMatrix(new THREE.Matrix4().extractRotation(u.mesh.matrixWorld));
  return m;
}

// small grabbable ceramics on the tops
function addProps(key, rec) {
  const mk = (pr, color, rough) => { const m = new THREE.Mesh(new THREE.LatheGeometry(pr.map(([r, y]) => new THREE.Vector2(r, y)), 48), new THREE.MeshStandardMaterial({ color, roughness: rough })); m.castShadow = m.receiveShadow = true; m.geometry.computeBoundingBox(); return m; };
  const vase = (h, r) => [[0, 0], [r * 0.62, 0], [r * 0.9, h * 0.08], [r, h * 0.3], [r * 0.92, h * 0.55], [r * 0.55, h * 0.82], [r * 0.42, h * 0.95], [r * 0.46, h], [r * 0.4, h], [0, h * 0.86]];
  const bowl = [[0, 0], [0.045, 0], [0.09, 0.025], [0.115, 0.065], [0.11, 0.068], [0.085, 0.03], [0, 0.008]];
  const list = key === 'onda' ? [[vase(0.3, 0.1), '#D9D2C3', 0.5, -0.55, 0.2], [vase(0.18, 0.07), '#2F2C28', 0.6, -0.38, 0.28]]
    : key === 'aura' ? [[bowl, '#3A3632', 0.55, 0.82, 0.24], [vase(0.24, 0.08), '#C9B79C', 0.6, 1.05, 0.22]] : [];
  for (const [pr, c, r, x, z] of list) {
    const m = mk(pr, c, r); rec.holder.add(m);
    m.position.set(x, rec.size.y + 0.05, z);
    rec.holder.updateMatrixWorld(true); scene.attach(m);
    loose.push({ mesh: m, vel: V(), resting: false, upright: true, half: 0, prop: true });   // settles onto the top
  }
}


// ════════════════════════════════════════════════════════════════════ load the three pieces
const loader = new GLTFLoader();
const progress = {};
function setProgress(k, f) { progress[k] = f; const v = Object.values(progress); $('#pct').textContent = Math.round(100 * v.reduce((a, b) => a + b, 0) / 3) + '%'; }
const motions = await fetch('assets/motions.json').then(r => r.json());
await Promise.all(['aura', 'onda', 'arcos'].map(k => new Promise((res, rej) => loader.load(`assets/${k}.glb`, g => { setProgress(k, 1); setupPiece(k, g); res(); }, e => e.total && setProgress(k, e.loaded / e.total), rej))));

// ════════════════════════════════════════════════════════════════════ tablets
const tA = new Tablet('Atmosphere'), tB = new Tablet('Listening room');
const tabletWall = new THREE.Group(); tabletWall.position.set(ROOM.W / 2 - 0.003, 0, 1.7); tabletWall.rotation.y = -Math.PI / 2; scene.add(tabletWall);
tA.group.position.set(-0.17, 1.32, 0); tB.group.position.set(0.17, 1.32, 0); tabletWall.add(tA.group, tB.group);
const tablets = [tA, tB];
const fmtH = h => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
const presets = [['Dawn', 6.6], ['Day', 12.5], ['Golden', 18.4], ['Night', 22.0]];
presets.forEach(([n, h], i) => tA.button('tod' + i, 48 + i * 272, 160, 252, 130, n, { sub: () => fmtH(h), active: s => Math.abs(s.hourTarget - h) < 0.05 }));
tA.slider('hour', 48, 360, 1084, 'Time of day', { value: s => (s.hourTarget - 5) / 18, fmt: s => fmtH(s.hourTarget), gradient: ['#203050', '#E8A86A', '#F6EBD8', '#E8A86A', '#203050'] });
tA.slider('rot', 48, 480, 1084, 'Sun direction', { value: s => (s.sunRot + 1) / 2, fmt: s => `${Math.round(s.sunRot * 70)}°` });
tA.slider('dim', 48, 600, 700, 'Interior lights', { value: s => s.dimmer });
tA.button('gallery', 790, 590, 165, 110, 'Spots', { active: s => s.gallery, small: true });
tA.button('shafts', 967, 590, 165, 110, 'Sunbeams', { active: s => s.shafts, small: true });
tA.text((g, s, W, H) => { g.fillStyle = 'rgba(237,232,224,0.45)'; g.font = '400 22px "Helvetica Neue", Arial'; g.textAlign = 'left'; g.fillText('Point and pull the trigger, or tap with your finger.', 48, H - 40); });
const RK = ['onda', 'arcos', 'aura'];
RK.forEach((k, i) => tB.button('rec' + i, 48 + i * 364, 160, 344, 220, () => `${RECORDS[k].title}`, {
  sub: s => s.playing === k ? '▮▮  now playing on ' + k.toUpperCase() : '▶  play on ' + k.toUpperCase(), active: s => s.playing === k,
}));
tB.slider('vol', 48, 450, 1084, 'Volume', { value: s => s.volume });
tB.button('openall', 48, 560, 344, 110, 'Open everything', { small: true });
tB.button('closeall', 412, 560, 344, 110, 'Close everything', { small: true });
tB.button('reset', 776, 560, 356, 110, 'Reset room', { small: true });
tB.text((g, s, W, H) => { g.fillStyle = 'rgba(237,232,224,0.45)'; g.font = '400 22px "Helvetica Neue", Arial'; g.textAlign = 'left'; g.fillText('Grab doors, drawers and records · press a turntable to play · left stick walks, right stick turns', 48, H - 40); });

function uiAction(id, v) {
  if (id.startsWith('tod')) S.hourTarget = presets[+id.slice(3)][1];
  else if (id === 'hour') S.hourTarget = 5 + v * 18;
  else if (id === 'rot') S.sunRot = v * 2 - 1;
  else if (id === 'dim') S.dimmer = v;
  else if (id === 'gallery') S.gallery = !S.gallery;
  else if (id === 'shafts') S.shafts = !S.shafts;
  else if (id.startsWith('rec')) togglePlay(RK[+id.slice(3)]);
  else if (id === 'vol') { S.volume = v; if (music) for (const k of RK) if (S.playing === k) music.out[k].gain.setTargetAtTime(v, music.ctx.currentTime, 0.05); }
  else if (id === 'openall') movers.forEach(m => (m.target = 1, m.anim = true));
  else if (id === 'closeall') movers.forEach(m => (m.target = 0, m.anim = true));
  else if (id === 'reset') resetRoom();
  shadowDirty = true;
  tablets.forEach(t => t.draw(S));
}
tablets.forEach(t => t.draw(S));

// ════════════════════════════════════════════════════════════════════ audio
function ensureAudio() {
  if (music) { if (music.ctx.state !== 'running') music.ctx.resume(); return; }
  const ctx = listener.context; ctx.resume();
  music = new Music(ctx);
  for (const k of RK) {
    const rec = pieces[k];
    for (const p of rec.speakers.length ? rec.speakers : [V(0, rec.size.y * 0.5, rec.size.z)]) {
      const pa = new THREE.PositionalAudio(listener); pa.setRefDistance(1.4); pa.setRolloffFactor(1.1); pa.panner.panningModel = 'HRTF';
      pa.position.copy(p); rec.inner.add(pa); pa.setNodeSource(music.out[k]); pa.setVolume(0.9);
    }
  }
}
function togglePlay(k) {
  ensureAudio();
  if (S.playing === k) { music.stop(); S.playing = null; }
  else { music.play(k); music.out[k].gain.setTargetAtTime(S.volume, music.ctx.currentTime + 1.2, 0.3); S.playing = k; }
  for (const r of RK) pieces[r].playing = S.playing === r;
  tablets.forEach(t => t.draw(S));
}

// ════════════════════════════════════════════════════════════════════ movers / loose objects / reset
function applyMover(mv) {
  mv.node.position.lerpVectors(mv.p0, mv.p1, mv.t);
  mv.node.quaternion.slerpQuaternions(mv.q0, mv.q1, mv.t);
}
function resetRoom() {
  for (const mv of movers) { mv.target = 0; mv.anim = true; }
  for (const u of lpUnits) if (u.out) rackHide(u, false);
  for (let i = loose.length - 1; i >= 0; i--) if (loose[i].unit) { scene.remove(loose[i].mesh); loose.splice(i, 1); }
  for (const l of loose) if (l.home) { l.mesh.position.copy(l.home.p); l.mesh.quaternion.copy(l.home.q); l.resting = true; l.vel.set(0, 0, 0); }
  for (const k of RK) { const r = pieces[k]; r.holder.position.set(0, 0.03, 0.04); r.holder.rotation.set(0, 0, 0); }
  rig.position.copy(START.pos); rig.rotation.y = START.yaw;
}

// ════════════════════════════════════════════════════════════════════ input: XR controllers + hands
const ctrlFactory = new XRControllerModelFactory(), handFactory = new XRHandModelFactory();
const hands = [];
for (let i = 0; i < 2; i++) {
  const ray = renderer.xr.getController(i), grip = renderer.xr.getControllerGrip(i), hand = renderer.xr.getHand(i);
  grip.add(ctrlFactory.createControllerModel(grip)); hand.add(handFactory.createHandModel(hand, 'mesh'));
  rig.add(ray, grip, hand);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(), V(0, 0, -1)]), new THREE.LineBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.5 }));
  line.scale.z = 1.5; ray.add(line);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 16, 8), new THREE.MeshBasicMaterial({ color: '#FFFFFF' })); dot.visible = false; scene.add(dot);
  const H = { i, ray, grip, hand, line, dot, src: null, held: null, selecting: false, squeezing: false, hist: [], hover: null };
  ray.addEventListener('connected', e => { H.src = e.data; line.visible = !e.data.hand; });
  ray.addEventListener('disconnected', () => { H.src = null; });
  ray.addEventListener('selectstart', () => { H.selecting = true; ensureAudio(); press(H, 'select'); });
  ray.addEventListener('selectend', () => { H.selecting = false; release(H); });
  ray.addEventListener('squeezestart', () => { H.squeezing = true; press(H, 'squeeze'); });
  ray.addEventListener('squeezeend', () => { H.squeezing = false; release(H); });
  hands.push(H);
}
const _v = V(), _v2 = V(), _q = new THREE.Quaternion(), raycaster = new THREE.Raycaster();
function grabPoint(H, out) {
  const j = H.hand.joints;
  if (H.src && H.src.hand && j['index-finger-tip'] && j['thumb-tip']) return out.copy(j['index-finger-tip'].position).add(j['thumb-tip'].position).multiplyScalar(0.5).applyMatrix4(rig.matrixWorld);
  return H.grip.getWorldPosition(out);
}
function haptic(H, a = 0.4, ms = 25) { try { H.src?.gamepad?.hapticActuators?.[0]?.pulse(a, ms); } catch (e) {} }

// near-field candidate at point p
function nearTarget(p, kind) {
  let best = null, bd = 0.11;
  for (const l of loose) { if (l.held) continue; const d = l.mesh.position.distanceTo(p); if (d < bd) { bd = d; best = { type: 'loose', l }; } }
  if (best) return best;
  for (const u of lpUnits) {
    if (u.out) continue;
    u.mesh.updateMatrixWorld(); _v.copy(p).applyMatrix4(_m4.copy(u.mesh.matrixWorld).invert());
    const e = u.box.clone().expandByScalar(0.02); if (e.containsPoint(_v)) { const d = _v.distanceTo(u.center); if (d < (best?.d ?? 1)) best = { type: 'lp', u, d }; }
  }
  if (best) return best;
  for (const mv of movers) {
    for (const m of mv.meshes || []) {
      m.updateMatrixWorld(); _v.copy(p).applyMatrix4(_m4.copy(m.matrixWorld).invert()); m.geometry.computeBoundingBox();
      if (m.geometry.boundingBox.clone().expandByScalar(0.035).containsPoint(_v)) return { type: 'mover', mv };
    }
  }
  for (const h of hitTargets) if (h.userData.turntable) { h.updateMatrixWorld(); _v.copy(p).applyMatrix4(_m4.copy(h.matrixWorld).invert()); h.geometry.computeBoundingBox(); if (h.geometry.boundingBox.clone().expandByScalar(0.03).containsPoint(_v)) return { type: 'turntable', key: h.userData.turntable }; }
  if (kind === 'squeeze') for (const k of RK) { const r = pieces[k]; r.holder.updateMatrixWorld(); _v.copy(p).applyMatrix4(_m4.copy(r.holder.matrixWorld).invert()); const b = new THREE.Box3(V(-r.size.x / 2, 0, 0), V(r.size.x / 2, r.size.y, r.size.z)).expandByScalar(0.04); if (b.containsPoint(_v)) return { type: 'piece', r }; }
  return null;
}
const _m4 = new THREE.Matrix4();
function rayTarget(H) {
  H.ray.updateMatrixWorld(); raycaster.ray.origin.setFromMatrixPosition(H.ray.matrixWorld); raycaster.ray.direction.set(0, 0, -1).transformDirection(H.ray.matrixWorld);
  return pick(raycaster);
}
function pick(rc) {
  rc.far = 12;
  const objs = [...tablets.map(t => t.screen), ...hitTargets, ...loose.map(l => l.mesh), ...colliders];
  const hits = rc.intersectObjects(objs, false);
  // LP boxes (ray vs box in rack space)
  let lpHit = null, lpD = Infinity;
  for (const u of lpUnits) {
    if (u.out) continue;
    u.mesh.updateMatrixWorld(); const inv = _m4.copy(u.mesh.matrixWorld).invert(); const r2 = rc.ray.clone().applyMatrix4(inv);
    const pt = r2.intersectBox(u.box, _v2); if (pt) { const d = pt.applyMatrix4(u.mesh.matrixWorld).distanceTo(rc.ray.origin); if (d < lpD) { lpD = d; lpHit = u; } }
  }
  const h = hits[0];
  if (lpHit && (!h || lpD <= h.distance + 0.01)) return { type: 'lp', u: lpHit, point: rc.ray.at(lpD, V()), distance: lpD };
  if (!h) return null;
  const o = h.object;
  if (o.userData.tablet) return { type: 'tablet', t: o.userData.tablet, uv: h.uv, point: h.point, distance: h.distance };
  if (o.userData.turntable) return { type: 'turntable', key: o.userData.turntable, point: h.point, distance: h.distance };
  if (o.userData.mover) return { type: 'mover', mv: o.userData.mover, point: h.point, distance: h.distance };
  const l = loose.find(x => x.mesh === o); if (l) return { type: 'loose', l, point: h.point, distance: h.distance };
  return { type: 'surface', point: h.point, distance: h.distance };
}

function press(H, kind) {
  const p = grabPoint(H, V());
  let t = nearTarget(p, kind), far = false;
  if (!t && kind === 'select') { t = rayTarget(H); far = true; }
  if (!t) return;
  haptic(H, 0.5, 30);
  if (t.type === 'tablet') { H.uiTablet = t.t; t.t.pointer(t.uv, true, S, uiAction); return; }
  if (t.type === 'turntable') { togglePlay(t.key); return; }
  if (t.type === 'mover') {
    if (far) { t.mv.target = t.mv.t > 0.5 ? 0 : 1; t.mv.anim = true; return; }
    t.mv.anim = false; t.mv.node.updateMatrixWorld();
    H.held = { type: 'mover', mv: t.mv, local: t.mv.node.worldToLocal(p.clone()) }; return;
  }
  if (t.type === 'lp') { const m = lpMeshFromUnit(t.u); rackHide(t.u, true); scene.add(m); const l = { mesh: m, vel: V(), resting: false, unit: t.u, half: 0.002 }; loose.push(l); grabLoose(H, l, p, far); return; }
  if (t.type === 'loose') { grabLoose(H, t.l, p, far); return; }
  if (t.type === 'piece') { const r = t.r; H.held = { type: 'piece', r, startHolder: r.holder.position.clone(), startYaw: r.holder.rotation.y, startP: r.bay.worldToLocal(p.clone()), startCtrlYaw: ctrlYaw(H) }; }
}
function ctrlYaw(H) { H.grip.getWorldQuaternion(_q); const f = V(0, 0, -1).applyQuaternion(_q); return Math.atan2(f.x, f.z); }
function grabLoose(H, l, p, far) {
  l.held = H; l.resting = false;
  const target = far ? 'fly' : 'hold';
  H.held = { type: 'loose', l, mode: target, fly: 0 };
  if (!far) { H.grip.attach(l.mesh); }
}
function release(H) {
  if (H.uiTablet) { H.uiTablet.pointer(null, false, S, uiAction); H.uiTablet = null; }
  const h = H.held; if (!h) return; H.held = null;
  if (h.type === 'loose') {
    const l = h.l; l.held = null; scene.attach(l.mesh);
    // back into the rack if released close to its slot
    if (l.unit) {
      const slot = l.unit.center.clone().applyMatrix4(l.unit.mesh.matrixWorld);
      if (slot.distanceTo(l.mesh.position) < 0.14) { rackHide(l.unit, false); scene.remove(l.mesh); loose.splice(loose.indexOf(l), 1); haptic(H, 0.3, 20); return; }
    }
    const n = H.hist.length; l.vel.copy(n > 4 ? H.hist[n - 1].clone().sub(H.hist[n - 5]).multiplyScalar(1 / (4 / 72)) : V()); l.vel.clampLength(0, 4);
    l.resting = false;
  }
  if (h.type === 'mover') { h.mv.target = h.mv.t > 0.5 ? 1 : 0; }
}

// ════════════════════════════════════════════════════════════════════ desktop fallback
const keys = {}; let yaw = 0, pitch = -0.05, dragging = false, deskHeld = null;
addEventListener('keydown', e => (keys[e.code] = true)); addEventListener('keyup', e => (keys[e.code] = false));
renderer.domElement.addEventListener('pointerdown', e => { dragging = { x: e.clientX, y: e.clientY, moved: false }; });
addEventListener('pointermove', e => { if (!dragging || renderer.xr.isPresenting) return; const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y; if (Math.abs(dx) + Math.abs(dy) > 3) dragging.moved = true; yaw -= dx * 0.004; pitch = clamp(pitch - dy * 0.004, -1.3, 1.3); dragging.x = e.clientX; dragging.y = e.clientY; });
addEventListener('pointerup', e => { if (dragging && !dragging.moved) deskClick(e); dragging = false; });
function deskClick(e) {
  ensureAudio();
  const ndc = new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  if (deskHeld) { const l = deskHeld; l.held = null; scene.attach(l.mesh); l.vel.set(0, 0, 0); l.resting = false; deskHeld = null; return; }
  const t = pick(raycaster); if (!t) return;
  if (t.type === 'tablet') { t.t.pointer(t.uv, true, S, uiAction); t.t.pointer(t.uv, false, S, uiAction); }
  else if (t.type === 'turntable') togglePlay(t.key);
  else if (t.type === 'mover') { t.mv.target = t.mv.t > 0.5 ? 0 : 1; t.mv.anim = true; }
  else if (t.type === 'lp') { const m = lpMeshFromUnit(t.u); rackHide(t.u, true); scene.add(m); const l = { mesh: m, vel: V(), resting: false, unit: t.u, half: 0.002 }; loose.push(l); deskHold(l); }
  else if (t.type === 'loose') deskHold(t.l);
}
function deskHold(l) { l.held = 'desk'; deskHeld = l; camera.attach(l.mesh); l.mesh.position.set(0.12, -0.12, -0.45); }

// ════════════════════════════════════════════════════════════════════ time of day / lighting
const C = (h) => new THREE.Color(h);
const SKY = { night: [C('#0A1020'), C('#1C2236')], dawn: [C('#6D86B5'), C('#F2B98E')], day: [C('#5E8FC9'), C('#EADFCF')], golden: [C('#6377A8'), C('#F59E5E')] };
function lighting(dt) {
  S.hour += (S.hourTarget - S.hour) * Math.min(1, dt * (Math.abs(S.hourTarget - S.hour) > 2 ? 0.55 : 1.6));
  const h = S.hour;
  const elev = h < 5.8 || h > 20.2 ? -0.2 : Math.sin(clamp((h - 5.8) / 14.4, 0, 1) * Math.PI) * 0.95 - 0.05;
  const az = S.sunRot * 1.2 + (h - 13) * -0.09;
  const dir = V(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev)).normalize();
  const day = smooth(-0.05, 0.25, elev), low = 1 - smooth(0.08, 0.5, elev);
  sun.position.copy(dir).multiplyScalar(12); sun.target.position.set(0, 0.8, -0.5);
  sun.intensity = 5.2 * day; sun.color.copy(C('#FFF2DE')).lerp(C('#FF9B55'), low * 0.85);
  R.sky.material.uniforms.sunDir.value.copy(dir);
  const pre = h < 12 ? SKY.dawn : SKY.golden, mid = low > 0.5 ? pre : SKY.day;
  const top = SKY.night[0].clone().lerp(mid[0], day).lerp(pre[0], low * day * 0.6), hor = SKY.night[1].clone().lerp(mid[1], day).lerp(pre[1], low * day * 0.7);
  R.sky.material.uniforms.top.value.copy(top); R.sky.material.uniforms.hor.value.copy(hor);
  R.sky.material.uniforms.sunCol.value.copy(sun.color).multiplyScalar(day);
  hemi.color.copy(C('#1E2638')).lerp(C('#CFDDF0'), day); hemi.groundColor.copy(C('#1A1512')).lerp(C('#7A6450'), day); hemi.intensity = 0.28 + 0.3 * day;
  scene.environmentIntensity = 0.16 + 0.36 * day;
  const night = 1 - day;
  const lvl = music ? music.meter() : 0;
  for (const k of RK) {
    const sp = spots[k]; if (!sp) continue;
    const base = S.gallery ? (14 + 26 * night) * (0.25 + 0.75 * S.dimmer) : 0;
    sp.intensity = base * (pieces[k].playing ? 1 + lvl * 0.35 : 1);
  }
  R.cove.emissiveIntensity = (0.7 + 1.2 * night) * (0.35 + 0.65 * S.dimmer) * (1 + lvl * 0.4);
  R.landM.color.copy(C('#1B2130')).lerp(C('#FFFFFF'), day).lerp(C('#FFC9A0'), low * day * 0.5);
  R.bulb.intensity = 2.6 * night * S.dimmer; R.shadeM.emissiveIntensity = 0.1 + 0.9 * night * S.dimmer;
  for (const m of pieces.aura?.glowMats || []) m.emissiveIntensity = (0.5 + 0.8 * night) * (S.playing === 'aura' ? 0.8 + lvl * 1.6 : 1);
  renderer.toneMappingExposure = 0.95 + 0.15 * night;
  R.ceilM.emissiveIntensity = 0.06 + 0.18 * day + 0.08 * night * S.dimmer;   // stands in for light bouncing off the floor
  // sunbeams through the glazing
  const beam = S.shafts ? smooth(0.04, 0.2, elev) * (1 - smooth(0.55, 0.9, elev)) * smooth(0.1, 0.4, dir.z) : 0;
  shafts.mat.opacity += (beam * 0.07 - shafts.mat.opacity) * Math.min(1, dt * 3);
  shafts.dust.material.opacity += ((S.shafts ? 0.25 + beam * 0.55 : 0) - shafts.dust.material.opacity) * Math.min(1, dt * 3);
  shafts.group.visible = shafts.mat.opacity > 0.003;
  const axis = dir.clone().negate();
  shafts.group.children.forEach((p, i) => {
    const start = V(-1.5 + i * 1.0, 1.4, ROOM.D / 2 + 0.05), c = start.clone().addScaledVector(axis, 3);
    p.position.copy(c);
    const toCam = camera.getWorldPosition(_v2).sub(c); toCam.addScaledVector(axis, -toCam.dot(axis)).normalize();
    const x = V().crossVectors(axis, toCam).normalize(); p.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, axis, toCam));
  });
  if (!lastSun || lastSun.distanceToSquared(dir) > 1e-7) { shadowDirty = true; lastSun = dir.clone(); }
  return { dir, elev };
}
let lastSun = null, shadowDirty = true;
function clockText() { return fmtH(S.hour); }

// ════════════════════════════════════════════════════════════════════ frame loop
const clock = new THREE.Timer(); let snapReady = [true, true], uiTick = 0;
function frame() {
  clock.update(); const dt = Math.min(0.05, clock.getDelta());
  lighting(dt);
  // movers animate towards their target when not held
  for (const mv of movers) { if (mv.anim) { shadowDirty = true; mv.t += (mv.target - mv.t) * Math.min(1, dt * 3.2); if (Math.abs(mv.target - mv.t) < 0.002) { mv.t = mv.target; mv.anim = false; } applyMover(mv); } }
  // turntables
  for (const k of RK) {
    const r = pieces[k]; if (!r) continue;
    if (r.spinner) r.spinner.rotation.y -= (r.playing ? 3.49 : 0) * dt;
    if (r.arm) { const tgt = r.playing ? 0.32 : 0; r.armAngle += (tgt - r.armAngle) * Math.min(1, dt * 2.5); r.arm.rotation.y = r.armAngle * r.armSign; }
  }
  // XR hands
  if (renderer.xr.isPresenting) {
    for (const H of hands) {
      const p = grabPoint(H, V()); H.hist.push(p.clone()); if (H.hist.length > 10) H.hist.shift();
      const h = H.held;
      if (h?.type === 'mover') {
        const mv = h.mv, par = mv.node.parent; par.updateMatrixWorld();
        let bt = mv.t, bd = Infinity;
        for (let s = 0; s <= 48; s++) {
          const t = s / 48; _v.lerpVectors(mv.p0, mv.p1, t); _q.slerpQuaternions(mv.q0, mv.q1, t);
          _m4.compose(_v, _q, mv.s0).premultiply(par.matrixWorld); const w = h.local.clone().applyMatrix4(_m4); const d = w.distanceTo(p);
          if (d < bd) { bd = d; bt = t; }
        }
        mv.t += (bt - mv.t) * 0.6; applyMover(mv); shadowDirty = true;
      } else if (h?.type === 'loose' && h.mode === 'fly') {
        h.fly = Math.min(1, h.fly + dt * 3.5); const l = h.l; l.mesh.position.lerp(p, h.fly * 0.35);
        if (h.fly >= 1 || l.mesh.position.distanceTo(p) < 0.05) { h.mode = 'hold'; H.grip.attach(l.mesh); haptic(H, 0.6, 40); }
      } else if (h?.type === 'piece') {
        const r = h.r, lp = r.bay.worldToLocal(p.clone()), d = lp.sub(h.startP);
        r.holder.position.x = clamp(h.startHolder.x + d.x, -2.2, 2.2); r.holder.position.z = clamp(h.startHolder.z + d.z, 0.04, 2.0);
        r.holder.rotation.y = h.startYaw + (ctrlYaw(H) - h.startCtrlYaw); shadowDirty = true;
        r.holder.position.y = Math.abs(r.holder.position.x) < 0.25 && r.holder.position.z < 0.2 ? 0.03 : 0;
      }
      // pointer ray: hover + tablets
      if (H.src && !H.src.hand) {
        const t = rayTarget(H);
        const show = t && ['tablet', 'turntable', 'mover', 'lp', 'loose'].includes(t.type) && t.distance < 6;
        H.line.scale.z = show ? t.distance : 0.35; H.line.material.opacity = show ? 0.8 : 0.25; H.dot.visible = !!show; if (show) H.dot.position.copy(t.point);
        if (t?.type === 'tablet') { t.t.pointer(t.uv, H.selecting && H.uiTablet === t.t, S, uiAction); }
        const hk = show ? t.type + (t.u?.v0 ?? t.mv?.name ?? t.key ?? '') : null; if (hk !== H.hover) { H.hover = hk; if (hk) haptic(H, 0.12, 8); }
      } else if (H.src && H.src.hand) {
        // finger poke on tablets
        const tip = H.hand.joints['index-finger-tip'];
        if (tip) for (const tb of tablets) {
          const w = tip.getWorldPosition(V()), loc = tb.screen.worldToLocal(w.clone());
          if (Math.abs(loc.x) < tb.w / 2 && Math.abs(loc.y) < tb.h / 2 && loc.z < 0.012 && loc.z > -0.03) { tb.pointer(new THREE.Vector2(loc.x / tb.w + 0.5, loc.y / tb.h + 0.5), true, S, uiAction); H.poking = tb; }
          else if (H.poking === tb) { tb.pointer(null, false, S, uiAction); H.poking = null; }
        }
      }
      // locomotion
      const gp = H.src?.gamepad;
      if (gp && gp.axes.length >= 4) {
        const ax = gp.axes[2], ay = gp.axes[3];
        if (H.src.handedness === 'left' && Math.hypot(ax, ay) > 0.15) {
          const f = camera.getWorldDirection(V()); f.y = 0; f.normalize(); const rgt = V().crossVectors(f, V(0, 1, 0));
          rig.position.addScaledVector(f, -ay * 1.6 * dt).addScaledVector(rgt, ax * 1.6 * dt);
        }
        if (H.src.handedness === 'right') {
          if (Math.abs(ax) > 0.7 && snapReady[H.i]) {
            snapReady[H.i] = false; const c = camera.getWorldPosition(V()), a = -Math.sign(ax) * Math.PI / 6;
            rig.position.sub(c).applyAxisAngle(V(0, 1, 0), a).add(c); rig.rotation.y += a;
          }
          if (Math.abs(ax) < 0.3) snapReady[H.i] = true;
        }
      }
    }
    const cw = camera.getWorldPosition(V());
    const lim = V(ROOM.W / 2 - 0.3, 0, ROOM.D / 2 - 0.3);
    if (Math.abs(cw.x) > lim.x) rig.position.x -= cw.x - Math.sign(cw.x) * lim.x;
    if (Math.abs(cw.z) > lim.z) rig.position.z -= cw.z - Math.sign(cw.z) * lim.z;
  } else {
    // desktop walk
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    const f = V(-Math.sin(yaw), 0, -Math.cos(yaw)), rgt = V(Math.cos(yaw), 0, -Math.sin(yaw)), sp = 1.8 * dt;
    if (keys.KeyW || keys.ArrowUp) rig.position.addScaledVector(f, sp); if (keys.KeyS || keys.ArrowDown) rig.position.addScaledVector(f, -sp);
    if (keys.KeyA || keys.ArrowLeft) rig.position.addScaledVector(rgt, -sp); if (keys.KeyD || keys.ArrowRight) rig.position.addScaledVector(rgt, sp);
    rig.position.x = clamp(rig.position.x, -ROOM.W / 2 + 0.3, ROOM.W / 2 - 0.3); rig.position.z = clamp(rig.position.z, -ROOM.D / 2 + 0.3, ROOM.D / 2 - 0.3);
  }
  // loose objects: simple gravity onto whatever is below
  for (const l of loose) {
    if (l.held) { shadowDirty = true; continue; }
    if (l.resting) continue;
    shadowDirty = true;
    l.vel.y -= 9.8 * dt; l.mesh.position.addScaledVector(l.vel, dt);
    l.mesh.position.x = clamp(l.mesh.position.x, -ROOM.W / 2 + 0.1, ROOM.W / 2 - 0.1); l.mesh.position.z = clamp(l.mesh.position.z, -ROOM.D / 2 + 0.1, ROOM.D / 2 - 0.1);
    raycaster.ray.origin.copy(l.mesh.position).add(V(0, 0.25, 0)); raycaster.ray.direction.set(0, -1, 0); raycaster.far = 3;
    const hit = raycaster.intersectObjects(colliders, false)[0];
    const ground = Math.max(0, hit ? hit.point.y : 0);
    if (!l.half) { l.mesh.geometry.computeBoundingBox(); l.half = l.upright ? 0 : 0.002; }
    if (l.mesh.position.y - l.half <= ground + 0.001 && l.vel.y <= 0) {
      l.mesh.position.y = ground + l.half; l.vel.set(0, 0, 0); l.resting = true;
      if (l.prop && !l.home) l.home = { p: l.mesh.position.clone(), q: l.mesh.quaternion.clone() };
      if (l.unit) {      // records come to rest lying flat
        const b = l.mesh.geometry.boundingBox, s = b.getSize(V()), thin = s.x < s.y && s.x < s.z ? V(1, 0, 0) : s.y < s.z ? V(0, 1, 0) : V(0, 0, 1);
        const n = thin.applyQuaternion(l.mesh.quaternion); l.mesh.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(n.y < 0 ? n.negate() : n, V(0, 1, 0)));
        l.mesh.position.y = ground + 0.003;
      } else if (l.upright) { const e = new THREE.Euler().setFromQuaternion(l.mesh.quaternion, 'YXZ'); l.mesh.quaternion.setFromEuler(new THREE.Euler(0, e.y, 0)); }
    }
  }
  if ((uiTick += dt) > 1) { uiTick = 0; S.clock = clockText(); tablets.forEach(t => t.draw(S)); }
  if (shadowDirty) { renderer.shadowMap.needsUpdate = true; shadowDirty = false; }
  renderer.render(scene, camera);
}
S.clock = clockText(); tablets.forEach(t => t.draw(S));
renderer.setAnimationLoop(frame);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ════════════════════════════════════════════════════════════════════ entry UI
S.ready = true;
$('#loading').classList.add('done');
const vrb = VRButton.createButton(renderer, { optionalFeatures: ['hand-tracking', 'local-floor', 'bounded-floor', 'layers'] });
vrb.id = 'vrbtn'; $('#enter').appendChild(vrb);
let revealed = false; const reveal = () => { if (revealed) return; revealed = true; S.hour = 21.8; S.hourTarget = 17.6; tablets.forEach(t => t.draw(S)); };
setTimeout(reveal, 1800);
renderer.xr.addEventListener('sessionstart', () => { ensureAudio(); camera.position.set(0, 0, 0); $('#hud').classList.add('hidden'); revealed = false; reveal(); });
renderer.xr.addEventListener('sessionend', () => { camera.position.set(0, 1.62, 0); $('#hud').classList.remove('hidden'); });
window.APP = { scene, renderer, camera, rig, pieces, movers, lpUnits, loose, S, uiAction, togglePlay, tablets, pick, raycaster, deskClick, setView(x, z, y, p) { rig.position.set(x, 0, z); yaw = y; pitch = p ?? pitch; } };
