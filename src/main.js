// ONDA · ARCOS · AURA - one-room WebXR experience (Meta Quest 3 browser + desktop fallback)
// Look and motion follow the browser review viewers: same materials, neutral grading, soft sun, window fill;
// doors / drawers move exactly as in the CAD (hinge and runner data exported with the models).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { ROOM, buildRoom, buildBay, contactShadow, lightShafts } from './room.js';
import { Tablet } from './tablet.js';
import { Music, RECORDS } from './music.js';
import * as PHYS from './physics.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const $ = s => document.querySelector(s);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Y = V(0, 1, 0);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const C = h => new THREE.Color(h);

// ════════════════════════════════════════════════════════════════════ renderer / scene (as the review viewer)
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.VSMShadowMap; renderer.shadowMap.autoUpdate = false;
renderer.xr.enabled = true; renderer.xr.setFoveation(0.5); renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);
RectAreaLightUniformsLib.init();

const scene = new THREE.Scene();
scene.background = C('#D8D2C8');
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.03, 200);
const rig = new THREE.Group(); rig.add(camera); scene.add(rig);
const START = { pos: V(0, 0, 1.45), yaw: 0 };
rig.position.copy(START.pos); camera.position.set(0, 1.62, 0);
const listener = new THREE.AudioListener(); camera.add(listener);

const R = buildRoom(scene);
const dust = lightShafts(scene).dust;

// lights: sun with soft shadows + a fill light in the glazing (the viewer's window fill) + gallery spots
const sun = new THREE.DirectionalLight('#FFE9CF', 1.15);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -4.5, right: 4.5, top: 4.5, bottom: -4.5, near: 1, far: 30 });
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02; sun.shadow.radius = 8; sun.shadow.blurSamples = 12;
scene.add(sun, sun.target);
const windowFill = new THREE.RectAreaLight('#FFF4E6', 2.2, R.gx * 2, R.gh);
windowFill.position.set(0, R.gh / 2, ROOM.D / 2 - 0.06); windowFill.lookAt(0, R.gh / 2, 0); scene.add(windowFill);
const hemi = new THREE.HemisphereLight('#F3EEE6', '#7A6450', 0.25); scene.add(hemi);
const spots = {};

// ════════════════════════════════════════════════════════════════════ state
const S = { hour: 21.8, hourTarget: 21.8, sunRot: 0.15, gallery: true, dimmer: 0.75, volume: 0.8, floor: 0, playing: null };
const pieces = {}, movers = [], lpUnits = [], loose = [], hitTargets = [], colliders = [], followers = [];
let music = null, shadowDirty = true;

const BAYS = {
  aura: { pos: V(0, 0, -ROOM.D / 2), rot: 0 },
  onda: { pos: V(-ROOM.W / 2, 0, -0.25), rot: Math.PI / 2 },
  arcos: { pos: V(ROOM.W / 2, 0, -0.6), rot: -Math.PI / 2 },
};
const INFO = {
  onda: { plaque: [['ONDA', 46, 700], ['Wave console', 28, 400], ['Smoked oak, carved wave relief', 22, 400, '#6E685F'], ['2260 × 450 × 830 mm', 22, 400, '#6E685F']] },
  arcos: { plaque: [['ARCOS', 46, 700], ['Arc sideboard', 28, 400], ['Walnut, 3form Koda XT fronts', 22, 400, '#6E685F'], ['1500 × 450 × 840 mm', 22, 400, '#6E685F']] },
  aura: { plaque: [['AURA', 46, 700], ['Modular listening console', 28, 400], ['Lacquer, white oak, lit sail', 22, 400, '#6E685F'], ['2500 × 480 × 750 mm', 22, 400, '#6E685F']] },
};
const RK = ['onda', 'arcos', 'aura'];

// ════════════════════════════════════════════════════════════════════ geometry helpers
const RX = {
  lp: /jacket|LP_sleeve/i,
  spinner: /Turntable_platter|LP_on_platter|^Platter|^Record$|^Record_label$/i,
  arm: /^Tonearm$|^Tonearm_tube$/i,
  armPivot: /^Tonearm_pivot$|^Tonearm_pillar$/i,
  speaker: /Speaker_[LR]_cabinet|^Soundbar_\(by|^Subwoofer_\(by/i,
  deck: /Turntable|Tonearm|Platter|^Record$|^Record_label$/i,
};
function ownMatch(o, stop, re) { for (let p = o; p && p !== stop; p = p.parent) if (re.test(p.name || '')) return p; return null; }
function cleanGeo(m, inv) {
  const g = m.geometry.clone();
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
function mergeInto(target, meshes, { bvh = false, collide = false } = {}) {
  target.updateMatrixWorld(true);
  const inv = target.matrixWorld.clone().invert(), byMat = new Map();
  for (const m of meshes) { const mat = Array.isArray(m.material) ? m.material[0] : m.material; if (!byMat.has(mat)) byMat.set(mat, []); byMat.get(mat).push(cleanGeo(m, inv)); }
  const out = [];
  for (const [mat, list] of byMat) {
    const geo = mergeGeometries(list); if (!geo) continue;
    const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = !mat.transparent; mesh.receiveShadow = true;
    if (bvh) geo.computeBoundsTree();
    if (collide) colliders.push(mesh);
    target.add(mesh); out.push(mesh);
  }
  return out;
}
const _bm = new THREE.Matrix4(), _bb = new THREE.Box3();
function boxOf(meshes, space) {
  const b = new THREE.Box3(); space.updateMatrixWorld(true); const inv = space.matrixWorld.clone().invert();
  for (const m of meshes) { m.geometry.computeBoundingBox(); _bb.copy(m.geometry.boundingBox).applyMatrix4(_bm.multiplyMatrices(inv, m.matrixWorld)); b.union(_bb); }
  return b;
}

// ════════════════════════════════════════════════════════════════════ pieces
function setupPiece(key, gltf, motions) {
  const bay = new THREE.Group(); bay.position.copy(BAYS[key].pos); bay.rotation.y = BAYS[key].rot; scene.add(bay);
  const src = gltf.scene; src.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(src), size = bb.getSize(V()), ctr = bb.getCenter(V());
  const holder = new THREE.Group(); holder.name = key; bay.add(holder);
  const inner = new THREE.Group(); holder.add(inner);
  inner.add(src); src.position.set(-ctr.x, -bb.min.y, -bb.min.z);
  const edge = new THREE.MeshStandardMaterial({ color: '#ECE6DD', roughness: 0.9 });
  const bp = buildBay(bay, key, { artY: 0.03 + size.y + 0.25 + 0.42, edge, brass: R.brass, plaque: INFO[key].plaque, plaqueX: size.x / 2 + 0.36, plinthW: size.x + 0.32, plinthD: size.z + 0.26 });
  holder.position.set(0, bp.plinthTop, 0.04); holder.updateMatrixWorld(true);
  const cs = contactShadow(size.x * 1.12, size.z * 1.5); cs.position.set(0, 0.002, size.z / 2); holder.add(cs);
  // plinth collider (bay space -> world)
  bay.updateMatrixWorld(true);
  { const c = V(0, bp.plinthTop / 2, (size.z + 0.26) / 2 + 0.01).applyMatrix4(bay.matrixWorld), q = new THREE.Quaternion().setFromAxisAngle(Y, BAYS[key].rot); PHYS.staticBox((size.x + 0.32) / 2, bp.plinthTop / 2, (size.z + 0.26) / 2, c, q); }

  const sp = new THREE.SpotLight('#FFE3BF', 0, 7, 0.42, 0.65, 1.6);
  sp.position.set(0, ROOM.H - 0.05, 1.5); sp.target.position.set(0, size.y * 0.8 + 0.3, 0.1); bay.add(sp, sp.target); spots[key] = sp;

  // classify
  const moverNodes = new Map(), mo = motions[key] || {};
  src.traverse(o => { const a = gltf.parser.associations.get(o); if (a && a.nodes !== undefined && mo[a.nodes]) moverNodes.set(o, mo[a.nodes]); });
  const ctxOf = o => { for (let p = o; p && p !== src.parent; p = p.parent) if (moverNodes.has(p)) return p; return src; };
  const groups = new Map(), spin = [], arm = [], armPivot = [], speakers = [], deck = [];
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
    G.static.push(m);
  }
  const rec = { key, bay, holder, inner, size, movers: [], speakers: [], spinner: null, arm: null, playing: false, spin: 0, armAngle: 0, home: holder.position.clone() };
  pieces[key] = rec;

  // physics: one kinematic body per piece (follows the holder) and one per door / drawer
  const fPiece = new PHYS.Follower(inner); followers.push(fPiece); rec.follower = fPiece;
  for (const m of [...(groups.get(src)?.static || []), ...spin, ...arm]) fPiece.box(boxOf([m], inner));

  // turntable
  if (spin.length) { const c = boxOf(spin, inner).getCenter(V()); const piv = new THREE.Group(); piv.position.copy(c); inner.add(piv); mergeInto(piv, spin); rec.spinner = piv; }
  if (arm.length) {
    const pc = boxOf(armPivot.length ? armPivot : arm, inner).getCenter(V());
    const piv = new THREE.Group(); piv.position.copy(pc); inner.add(piv); mergeInto(piv, arm); rec.arm = piv;
    // swing angle that brings the tip over the lead-in groove of the record
    piv.updateMatrixWorld(true);
    let tip = V(), far = -1; const tmp = V();
    for (const mm of piv.children) { const p = mm.geometry.attributes.position; for (let i = 0; i < p.count; i += 7) { tmp.fromBufferAttribute(p, i); const d = tmp.x * tmp.x + tmp.z * tmp.z; if (d > far) { far = d; tip.copy(tmp); } } }
    const plc = rec.spinner ? rec.spinner.position.clone().sub(pc) : V(); const rr = 0.135;
    let best = 0, bd = Infinity;
    for (let a = -1.2; a <= 1.2; a += 0.01) { const t = tip.clone().applyAxisAngle(Y, a); const d = Math.abs(Math.hypot(t.x - plc.x, t.z - plc.z) - rr); if (d < bd && Math.abs(a) > 0.05) { bd = d; best = a; } }
    rec.armOpen = best;
  }
  if (deck.length) {
    const b = boxOf(deck, inner), box = new THREE.Mesh(new THREE.BoxGeometry(...b.getSize(V()).toArray()), new THREE.MeshBasicMaterial({ visible: false }));
    box.position.copy(b.getCenter(V())); inner.add(box); box.userData.turntable = key; hitTargets.push(box);
  }
  for (const s of speakers) rec.speakers.push(boxOf([s], inner).getCenter(V()));

  for (const [node, m] of moverNodes) {
    const mv = { piece: key, node, t: 0, target: 0, p0: node.position.clone(), q0: node.quaternion.clone(), p1: V(...m.t), q1: new THREE.Quaternion(...m.r), name: m.name };
    movers.push(mv); rec.movers.push(mv);
  }
  for (const [ctx, G] of groups) {
    const target = ctx === src ? inner : ctx;
    if (ctx !== src) { const f = new PHYS.Follower(ctx); followers.push(f); for (const m of G.static) f.box(boxOf([m], ctx)); const mv = movers.find(x => x.node === ctx); mv.follower = f; }
    const meshes = mergeInto(target, G.static, { bvh: true, collide: ctx === src });
    if (ctx !== src) { const mv = movers.find(x => x.node === ctx); mv.meshes = meshes; for (const mm of meshes) { mm.userData.mover = mv; hitTargets.push(mm); } }
    if (G.lps.size) buildRack(target, G.lps, key);
  }
  for (const m of all) m.parent && m.parent.remove(m);
  addProps(key, rec);
}

// LP racks: all LPs of one context in one mesh, each LP keeps its vertex / index range
function buildRack(ctx, lpMap, key) {
  ctx.updateMatrixWorld(true);
  const inv = ctx.matrixWorld.clone().invert(), geos = [], units = [];
  let v0 = 0, i0 = 0, mat = null;
  for (const [node, meshes] of lpMap) {
    const parts = meshes.map(m => cleanGeo(m, inv)); mat = mat || meshes[0].material;
    const g = parts.length > 1 ? mergeGeometries(parts) : parts[0]; g.computeBoundingBox();
    units.push({ v0, vc: g.attributes.position.count, i0, ic: g.index.count, box: g.boundingBox.clone(), key, out: false });
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
  pa.needsUpdate = true; u.out = hide; shadowDirty = true;
}
function lpMeshFromUnit(u) {
  const ga = u.mesh.geometry.attributes, idx = u.mesh.geometry.index.array, c = u.center;
  const pos = new Float32Array(u.vc * 3), nor = new Float32Array(u.vc * 3), uv = new Float32Array(u.vc * 2);
  for (let i = 0; i < u.vc; i++) {
    const s = u.v0 + i;
    pos[i * 3] = u.orig[s * 3] - c.x; pos[i * 3 + 1] = u.orig[s * 3 + 1] - c.y; pos[i * 3 + 2] = u.orig[s * 3 + 2] - c.z;
    for (let k = 0; k < 3; k++) nor[i * 3 + k] = ga.normal.array[s * 3 + k];
    uv[i * 2] = ga.uv.array[s * 2]; uv[i * 2 + 1] = ga.uv.array[s * 2 + 1];
  }
  const ix = new Uint32Array(u.ic); for (let i = 0; i < u.ic; i++) ix[i] = idx[u.i0 + i] - u.v0;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(new THREE.BufferAttribute(ix, 1));
  geo.computeBoundingBox();
  // the rack lives in mm (mover / wrapper space) or m (inner): bake the world scale into the LP geometry
  u.mesh.updateMatrixWorld(true); const P = V(), Q = new THREE.Quaternion(), Sc = V(); u.mesh.matrixWorld.decompose(P, Q, Sc);
  geo.scale(Sc.x, Sc.y, Sc.z); geo.computeBoundingBox();
  const m = new THREE.Mesh(geo, u.mesh.material); m.castShadow = m.receiveShadow = true;
  m.position.copy(c).applyMatrix4(u.mesh.matrixWorld); m.quaternion.copy(Q); scene.add(m);
  return m;
}
function makeLoose(mesh, opts) { const l = { mesh, phys: new PHYS.Dynamic(mesh, opts), held: null, ...opts.extra }; loose.push(l); return l; }

// ceramics and books on the tops, as staged in the review viewer
function addProps(key, rec) {
  const lathe = (pr, color, rough) => { const m = new THREE.Mesh(new THREE.LatheGeometry(pr.map(([r, y]) => new THREE.Vector2(r, y)), 48), new THREE.MeshStandardMaterial({ color, roughness: rough })); m.castShadow = m.receiveShadow = true; return m; };
  const vase = (h, r) => [[0, 0], [r * 0.62, 0], [r * 0.9, h * 0.08], [r, h * 0.3], [r * 0.92, h * 0.55], [r * 0.55, h * 0.82], [r * 0.42, h * 0.95], [r * 0.46, h], [r * 0.4, h], [0, h * 0.86]];
  const bowl = [[0, 0], [0.045, 0], [0.09, 0.025], [0.115, 0.065], [0.11, 0.068], [0.085, 0.03], [0, 0.008]];
  const list = key === 'onda' ? [[vase(0.3, 0.1), '#D9D2C3', 0.5, -0.55, 0.2], [vase(0.18, 0.07), '#2F2C28', 0.6, -0.28, 0.3]]
    : key === 'aura' ? [[bowl, '#3A3632', 0.55, 0.82, 0.24], [vase(0.24, 0.08), '#C9B79C', 0.6, 0.55, 0.24]] : [];
  const down = new THREE.Raycaster(); rec.holder.updateMatrixWorld(true);
  for (const [pr, c, r, x, z] of list) {
    // set it down on the real top surface (tops are not flat everywhere)
    down.set(V(x, rec.size.y + 0.4, z).applyMatrix4(rec.holder.matrixWorld), V(0, -1, 0));
    const hit = down.intersectObjects(colliders, false)[0]; if (!hit || hit.point.y < rec.size.y * 0.6) continue;
    const m = lathe(pr, c, r); scene.add(m); m.position.copy(hit.point).y += 0.002;
    const l = makeLoose(m, { shape: 'hull', density: 1400, extra: { prop: true } });
    l.home = { p: m.position.clone(), q: m.quaternion.clone() };
  }
}

// ════════════════════════════════════════════════════════════════════ load
const loader = new GLTFLoader(), progress = {};
const setProgress = (k, f) => { progress[k] = f; $('#pct').textContent = Math.round(100 * Object.values(progress).reduce((a, b) => a + b, 0) / 3) + '%'; };
const motions = await fetch('assets/motions.json').then(r => r.json());
// room colliders: floor, walls, rug, reading corner
PHYS.staticBox(10, 0.5, 10, V(0, -0.5, 0));
PHYS.staticBox(ROOM.W / 2, ROOM.H / 2, 0.1, V(0, ROOM.H / 2, -ROOM.D / 2 - 0.1)); PHYS.staticBox(ROOM.W / 2, ROOM.H / 2, 0.1, V(0, ROOM.H / 2, ROOM.D / 2 + 0.1));
PHYS.staticBox(0.1, ROOM.H / 2, ROOM.D / 2, V(-ROOM.W / 2 - 0.1, ROOM.H / 2, 0)); PHYS.staticBox(0.1, ROOM.H / 2, ROOM.D / 2, V(ROOM.W / 2 + 0.1, ROOM.H / 2, 0));
PHYS.staticBox(0.43, 0.3, 0.43, V(-2.0, 0.3, 1.85), new THREE.Quaternion().setFromAxisAngle(Y, Math.PI * 0.8));
PHYS.staticBox(0.21, 0.24, 0.21, V(-1.3, 0.24, 2.25));
PHYS.staticBox(0.23, 0.28, 0.23, V(-2.45, 0.28, -2.15));
await Promise.all(RK.map(k => new Promise((res, rej) => loader.load(`assets/${k}.glb`, g => { setProgress(k, 1); setupPiece(k, g, motions); res(); }, e => e.total && setProgress(k, e.loaded / e.total), rej))));

// ════════════════════════════════════════════════════════════════════ tablets
const tA = new Tablet('Atmosphere'), tB = new Tablet('Listening room');
const tabletWall = new THREE.Group(); tabletWall.position.set(ROOM.W / 2 - 0.003, 0, 1.55); tabletWall.rotation.y = -Math.PI / 2; scene.add(tabletWall);
tA.group.position.set(-0.17, 1.32, 0); tB.group.position.set(0.17, 1.32, 0); tabletWall.add(tA.group, tB.group);
const tablets = [tA, tB];
const fmtH = h => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
const presets = [['Dawn', 6.6], ['Day', 12.5], ['Golden', 18.0], ['Night', 22.0]];
presets.forEach(([n, h], i) => tA.button('tod' + i, 48 + i * 272, 150, 252, 120, n, { sub: () => fmtH(h), active: s => Math.abs(s.hourTarget - h) < 0.05 }));
tA.slider('hour', 48, 330, 1084, 'Time of day', { value: s => (s.hourTarget - 5) / 18, fmt: s => fmtH(s.hourTarget), gradient: ['#203050', '#E8A86A', '#F6EBD8', '#E8A86A', '#203050'] });
tA.slider('rot', 48, 440, 1084, 'Sun direction', { value: s => (s.sunRot + 1) / 2, fmt: s => `${Math.round(s.sunRot * 70)}°` });
tA.slider('dim', 48, 550, 860, 'Interior lights', { value: s => s.dimmer });
tA.button('gallery', 952, 540, 180, 96, 'Spots', { active: s => s.gallery, small: true });
tA.slider('floor', 48, 680, 1084, 'Floor height (if the room feels too big or too small)', { value: s => (s.floor + 0.3) / 0.6, fmt: s => `${s.floor >= 0 ? '+' : ''}${Math.round(s.floor * 100)} cm`, gradient: ['#8FA3B8', '#8FA3B8'] });
RK.forEach((k, i) => tB.button('rec' + i, 48 + i * 364, 150, 344, 210, () => `${RECORDS[k].title}`, { sub: s => s.playing === k ? '▮▮  playing on ' + k.toUpperCase() : '▶  play on ' + k.toUpperCase(), active: s => s.playing === k }));
tB.slider('vol', 48, 430, 1084, 'Volume', { value: s => s.volume });
tB.button('openall', 48, 540, 344, 104, 'Open everything', { small: true });
tB.button('closeall', 412, 540, 344, 104, 'Close everything', { small: true });
tB.button('reset', 776, 540, 356, 104, 'Reset room', { small: true });
tB.text((g, s, W, H) => { g.fillStyle = 'rgba(237,232,224,0.5)'; g.font = '400 22px "Helvetica Neue", Arial'; g.textAlign = 'left';
  g.fillText('Grip: grab doors, drawers, records and ceramics · grip a cabinet to move it', 48, H - 112);
  g.fillText('Trigger: point to open / close or to pull a record to your hand · press a turntable to play', 48, H - 78);
  g.fillText('Left stick walks · right stick turns', 48, H - 44); });

function uiAction(id, v) {
  if (id.startsWith('tod')) S.hourTarget = presets[+id.slice(3)][1];
  else if (id === 'hour') S.hourTarget = 5 + v * 18;
  else if (id === 'rot') S.sunRot = v * 2 - 1;
  else if (id === 'dim') S.dimmer = v;
  else if (id === 'gallery') S.gallery = !S.gallery;
  else if (id === 'floor') { S.floor = Math.round((v * 0.6 - 0.3) * 100) / 100; rig.position.y = S.floor; }
  else if (id.startsWith('rec')) togglePlay(RK[+id.slice(3)]);
  else if (id === 'vol') { S.volume = v; if (music && S.playing) music.out[S.playing].gain.setTargetAtTime(v, music.ctx.currentTime, 0.05); }
  else if (id === 'openall') movers.forEach(m => (m.target = 1, m.anim = true));
  else if (id === 'closeall') movers.forEach(m => (m.target = 0, m.anim = true));
  else if (id === 'reset') resetRoom();
  shadowDirty = true;
  tablets.forEach(t => t.draw(S));
}

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

// ════════════════════════════════════════════════════════════════════ movers / reset
function applyMover(mv) { mv.node.position.lerpVectors(mv.p0, mv.p1, mv.t); mv.node.quaternion.slerpQuaternions(mv.q0, mv.q1, mv.t); shadowDirty = true; }
function resetRoom() {
  for (const mv of movers) { mv.target = 0; mv.anim = true; }
  for (let i = loose.length - 1; i >= 0; i--) { const l = loose[i]; if (l.unit) { rackHide(l.unit, false); l.phys.remove(); scene.remove(l.mesh); loose.splice(i, 1); } }
  for (const l of loose) if (l.home) { l.held = null; l.phys.hold(false); l.phys.place(l.home.p, l.home.q); }
  for (const k of RK) { const r = pieces[k]; r.holder.position.copy(r.home); r.holder.rotation.set(0, 0, 0); }
  rig.position.set(START.pos.x, S.floor, START.pos.z); rig.rotation.y = START.yaw;
}

// ════════════════════════════════════════════════════════════════════ input: XR controllers + hands
const ctrlFactory = new XRControllerModelFactory(), handFactory = new XRHandModelFactory();
const hands = [], _v = V(), _v2 = V(), _q = new THREE.Quaternion(), _m4 = new THREE.Matrix4(), raycaster = new THREE.Raycaster();
for (let i = 0; i < 2; i++) {
  const ray = renderer.xr.getController(i), grip = renderer.xr.getControllerGrip(i), hand = renderer.xr.getHand(i);
  grip.add(ctrlFactory.createControllerModel(grip)); hand.add(handFactory.createHandModel(hand, 'mesh'));
  rig.add(ray, grip, hand);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(), V(0, 0, -1)]), new THREE.LineBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.5 }));
  ray.add(line);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.007, 16, 8), new THREE.MeshBasicMaterial({ color: '#FFFFFF' })); dot.visible = false; scene.add(dot);
  const H = { i, ray, grip, hand, line, dot, src: null, held: null, selecting: false, hist: [], qhist: [], hover: null };
  ray.addEventListener('connected', e => { H.src = e.data; line.visible = !e.data.hand; });
  ray.addEventListener('disconnected', () => { H.src = null; });
  ray.addEventListener('selectstart', () => { H.selecting = true; ensureAudio(); press(H, 'select'); });
  ray.addEventListener('selectend', () => { H.selecting = false; release(H); });
  ray.addEventListener('squeezestart', () => press(H, 'squeeze'));
  ray.addEventListener('squeezeend', () => release(H));
  hands.push(H);
}
// grab frame: pinch point for hands, grip pose for controllers (world space)
function handFrame(H, outM) {
  const j = H.hand.joints;
  if (H.src && H.src.hand && j['index-finger-tip'] && j['thumb-tip'] && j.wrist) {
    const p = V().copy(j['index-finger-tip'].position).add(j['thumb-tip'].position).multiplyScalar(0.5);
    outM.compose(p, j.wrist.quaternion, V(1, 1, 1)).premultiply(rig.matrixWorld); return outM;
  }
  H.grip.updateMatrixWorld(true); return outM.copy(H.grip.matrixWorld);
}
function haptic(H, a = 0.4, ms = 25) { try { H.src?.gamepad?.hapticActuators?.[0]?.pulse(a, ms); } catch (e) {} }

function nearTarget(p, kind) {
  let best = null, bd = 0.1;
  for (const l of loose) { if (l.held) continue; l.mesh.geometry.computeBoundingSphere(); const d = l.mesh.position.distanceTo(p) - l.mesh.geometry.boundingSphere.radius * 0.5; if (d < bd) { bd = d; best = { type: 'loose', l }; } }
  if (best) return best;
  for (const u of lpUnits) {
    if (u.out) continue;
    _v.copy(p).applyMatrix4(_m4.copy(u.mesh.matrixWorld).invert());
    const s = u.mesh.matrixWorld.getMaxScaleOnAxis(), pad = 0.02 / s;
    if (u.box.clone().expandByScalar(pad).containsPoint(_v)) { const d = _v.distanceTo(u.center); if (!best || d < best.d) best = { type: 'lp', u, d }; }
  }
  if (best) return best;
  for (const mv of movers) for (const m of mv.meshes || []) {
    _v.copy(p).applyMatrix4(_m4.copy(m.matrixWorld).invert()); if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    if (m.geometry.boundingBox.clone().expandByScalar(0.035 / m.matrixWorld.getMaxScaleOnAxis()).containsPoint(_v)) return { type: 'mover', mv };
  }
  for (const h of hitTargets) if (h.userData.turntable) { _v.copy(p).applyMatrix4(_m4.copy(h.matrixWorld).invert()); if (!h.geometry.boundingBox) h.geometry.computeBoundingBox(); if (h.geometry.boundingBox.clone().expandByScalar(0.03).containsPoint(_v)) return { type: 'turntable', key: h.userData.turntable }; }
  if (kind === 'squeeze') for (const k of RK) { const r = pieces[k]; _v.copy(p).applyMatrix4(_m4.copy(r.holder.matrixWorld).invert()); const b = new THREE.Box3(V(-r.size.x / 2, 0, 0), V(r.size.x / 2, r.size.y, r.size.z)).expandByScalar(0.04); if (b.containsPoint(_v)) return { type: 'piece', r }; }
  return null;
}
function rayTarget(H) {
  H.ray.updateMatrixWorld(); raycaster.ray.origin.setFromMatrixPosition(H.ray.matrixWorld); raycaster.ray.direction.set(0, 0, -1).transformDirection(H.ray.matrixWorld);
  return pick(raycaster);
}
const _inv = new THREE.Matrix4(), _ray = new THREE.Ray();
function pick(rc) {
  rc.far = 12;
  const hits = rc.intersectObjects([...tablets.map(t => t.screen), ...hitTargets, ...loose.map(l => l.mesh), ...colliders], false);
  let lpHit = null, lpD = Infinity, lastMesh = null;
  for (const u of lpUnits) {
    if (u.out) continue;
    if (u.mesh !== lastMesh) { lastMesh = u.mesh; _inv.copy(u.mesh.matrixWorld).invert(); _ray.copy(rc.ray).applyMatrix4(_inv); }
    const pt = _ray.intersectBox(u.box, _v2); if (pt) { const d = pt.applyMatrix4(u.mesh.matrixWorld).distanceTo(rc.ray.origin); if (d < lpD) { lpD = d; lpHit = u; } }
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
  const F = handFrame(H, new THREE.Matrix4()), p = V().setFromMatrixPosition(F);
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
  if (t.type === 'lp') { const m = lpMeshFromUnit(t.u); rackHide(t.u, true); const l = makeLoose(m, { shape: 'box', density: 600, extra: { unit: t.u } }); grab(H, l, F, far); return; }
  if (t.type === 'loose') { grab(H, t.l, F, far); return; }
  if (t.type === 'piece') { const r = t.r; H.held = { type: 'piece', r, startHolder: r.holder.position.clone(), startYaw: r.holder.rotation.y, startP: r.bay.worldToLocal(p.clone()), startCtrlYaw: yawOf(F) }; }
}
function yawOf(M) { _q.setFromRotationMatrix(M); const f = V(0, 0, -1).applyQuaternion(_q); return Math.atan2(f.x, f.z); }
function grab(H, l, F, far) {
  l.held = H; l.phys.hold(true);
  H.held = { type: 'loose', l, mode: far ? 'fly' : 'hold', fly: 0, offset: far ? null : new THREE.Matrix4().copy(F).invert().multiply(l.mesh.matrixWorld) };
}
function release(H) {
  if (H.uiTablet) { H.uiTablet.pointer(null, false, S, uiAction); H.uiTablet = null; }
  const h = H.held; if (!h) return; H.held = null;
  if (h.type === 'loose') {
    const l = h.l; l.held = null;
    if (l.unit) {            // back into its slot if released close to it
      const slot = l.unit.center.clone().applyMatrix4(l.unit.mesh.matrixWorld);
      if (slot.distanceTo(l.mesh.position) < 0.13) { rackHide(l.unit, false); l.phys.remove(); scene.remove(l.mesh); loose.splice(loose.indexOf(l), 1); haptic(H, 0.3, 20); return; }
    }
    l.phys.hold(false);
    const n = H.hist.length;
    if (n > 5) { const v = H.hist[n - 1].clone().sub(H.hist[n - 5]).multiplyScalar(1 / (4 * H.dt)); l.phys.throw(v.clampLength(0, 5)); }
  }
  if (h.type === 'mover') { h.mv.target = h.mv.t > 0.5 ? 1 : 0; h.mv.anim = true; }
}

// ════════════════════════════════════════════════════════════════════ desktop fallback
const keys = {}; let yaw = 0, pitch = -0.05, dragging = false, deskHeld = null;
addEventListener('keydown', e => (keys[e.code] = true)); addEventListener('keyup', e => (keys[e.code] = false));
renderer.domElement.addEventListener('pointerdown', e => { dragging = { x: e.clientX, y: e.clientY, moved: false }; });
addEventListener('pointermove', e => { if (!dragging || renderer.xr.isPresenting) return; const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y; if (Math.abs(dx) + Math.abs(dy) > 3) dragging.moved = true; yaw -= dx * 0.004; pitch = clamp(pitch - dy * 0.004, -1.3, 1.3); dragging.x = e.clientX; dragging.y = e.clientY; });
addEventListener('pointerup', e => { if (dragging && !dragging.moved) deskClick(e); dragging = false; });
function deskClick(e) {
  ensureAudio();
  if (deskHeld) { const l = deskHeld; l.held = null; l.phys.hold(false); deskHeld = null; return; }
  raycaster.setFromCamera(new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1), camera);
  const t = pick(raycaster); if (!t) return;
  if (t.type === 'tablet') { t.t.pointer(t.uv, true, S, uiAction); t.t.pointer(t.uv, false, S, uiAction); }
  else if (t.type === 'turntable') togglePlay(t.key);
  else if (t.type === 'mover') { t.mv.target = t.mv.t > 0.5 ? 0 : 1; t.mv.anim = true; }
  else if (t.type === 'lp') { const m = lpMeshFromUnit(t.u); rackHide(t.u, true); const l = makeLoose(m, { shape: 'box', density: 600, extra: { unit: t.u } }); l.held = 'desk'; l.phys.hold(true); deskHeld = l; }
  else if (t.type === 'loose') { t.l.held = 'desk'; t.l.phys.hold(true); deskHeld = t.l; }
}

// ════════════════════════════════════════════════════════════════════ time of day
function lighting(dt) {
  S.hour += (S.hourTarget - S.hour) * Math.min(1, dt * (Math.abs(S.hourTarget - S.hour) > 2 ? 0.55 : 1.6));
  const h = S.hour;
  const elev = h < 5.8 || h > 20.2 ? -0.2 : Math.sin(clamp((h - 5.8) / 14.4, 0, 1) * Math.PI) * 0.9 - 0.04;
  const az = S.sunRot * 1.2 + (h - 13) * -0.09;
  const dir = V(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev)).normalize();
  const day = smooth(-0.05, 0.25, elev), low = 1 - smooth(0.08, 0.5, elev), night = 1 - day;
  sun.position.copy(dir).multiplyScalar(12); sun.target.position.set(0, 0.8, -0.4);
  sun.intensity = 1.15 * day; sun.color.copy(C('#FFE9CF')).lerp(C('#FFB273'), low * 0.8);
  windowFill.intensity = 0.1 + 1.9 * day; windowFill.color.copy(C('#FFF4E6')).lerp(C('#FFD2A8'), low * day * 0.6);
  scene.environmentIntensity = 0.1 + 0.2 * day;
  hemi.intensity = 0.1 + 0.18 * day;
  R.glassM.emissive.copy(C('#18213A')).lerp(C('#F1F4F6'), day).lerp(C('#FFD9B0'), low * day * 0.55); R.glassM.emissiveIntensity = 0.3 + 0.75 * day;
  R.sheerM.emissiveIntensity = 0.04 + 0.32 * day;
  scene.background.copy(C('#1A1B20')).lerp(C('#D8D2C8'), day);
  for (const k of RK) { const sp = spots[k]; if (sp) sp.intensity = S.gallery ? (10 + 24 * night) * (0.25 + 0.75 * S.dimmer) : 0; }
  R.cove.emissiveIntensity = (0.5 + 1.2 * night) * (0.35 + 0.65 * S.dimmer);
  R.bulb.intensity = 2.4 * night * S.dimmer; R.shadeM.emissiveIntensity = 0.1 + 0.9 * night * S.dimmer;
  R.ceilM.emissiveIntensity = 0.05 + 0.14 * day + 0.06 * night * S.dimmer;
  renderer.toneMappingExposure = 1.0 + 0.08 * night;
  dust.material.opacity += ((0.12 + 0.2 * day * (1 - low * 0.5)) - dust.material.opacity) * Math.min(1, dt * 2);
  if (!lastSun || lastSun.distanceToSquared(dir) > 1e-7) { shadowDirty = true; lastSun = dir.clone(); }
}
let lastSun = null;

// ════════════════════════════════════════════════════════════════════ frame loop
const clock = new THREE.Timer(); const snapReady = [true, true]; let uiTick = 0;
const _F = new THREE.Matrix4(), _P = V(), _Q = new THREE.Quaternion(), _S = V();
function frame() {
  clock.update(); const dt = Math.min(0.05, clock.getDelta());
  lighting(dt);
  for (const mv of movers) if (mv.anim) { mv.t += (mv.target - mv.t) * Math.min(1, dt * 3.2); if (Math.abs(mv.target - mv.t) < 0.002) { mv.t = mv.target; mv.anim = false; } applyMover(mv); }
  for (const k of RK) {          // turntables: platter spins up to 33 1/3, arm swings over the lead-in groove
    const r = pieces[k];
    r.spin += ((r.playing ? 3.49 : 0) - r.spin) * Math.min(1, dt * (r.playing ? 1.3 : 0.8));
    if (r.spinner) r.spinner.rotation.y -= r.spin * dt;
    if (r.arm) { const tgt = r.playing ? r.armOpen : 0; r.armAngle += clamp(tgt - r.armAngle, -0.6 * dt, 0.6 * dt); r.arm.rotation.y = r.armAngle; }
  }
  if (renderer.xr.isPresenting) {
    for (const H of hands) {
      handFrame(H, _F); _F.decompose(_P, _Q, _S); H.dt = dt;
      H.hist.push(_P.clone()); if (H.hist.length > 10) H.hist.shift();
      const h = H.held;
      if (h?.type === 'mover') {
        const mv = h.mv, par = mv.node.parent; par.updateMatrixWorld();
        let bt = mv.t, bd = Infinity;
        for (let s = 0; s <= 60; s++) {
          const t = s / 60; _v.lerpVectors(mv.p0, mv.p1, t); _q.slerpQuaternions(mv.q0, mv.q1, t);
          _m4.compose(_v, _q, mv.node.scale).premultiply(par.matrixWorld); const d = h.local.clone().applyMatrix4(_m4).distanceTo(_P);
          if (d < bd) { bd = d; bt = t; }
        }
        mv.t += (bt - mv.t) * 0.5; applyMover(mv);
      } else if (h?.type === 'loose') {
        const l = h.l;
        if (h.mode === 'fly') {
          h.fly = Math.min(1, h.fly + dt * 3);
          const pos = l.mesh.position.clone().lerp(_P, 0.12 + 0.5 * h.fly);
          l.phys.moveTo(pos, l.mesh.quaternion); l.mesh.position.copy(pos);
          if (h.fly >= 1 || pos.distanceTo(_P) < 0.04) { h.mode = 'hold'; h.offset = new THREE.Matrix4().copy(_F).invert().multiply(l.mesh.matrixWorld); haptic(H, 0.6, 40); }
        } else {
          const M = _m4.copy(_F).multiply(h.offset), p = V(), q = new THREE.Quaternion(), s = V(); M.decompose(p, q, s);
          l.phys.moveTo(p, q); l.mesh.position.copy(p); l.mesh.quaternion.copy(q);
        }
        shadowDirty = true;
      } else if (h?.type === 'piece') {
        const r = h.r, d = r.bay.worldToLocal(_P.clone()).sub(h.startP), yawN = h.startYaw + (yawOf(_F) - h.startCtrlYaw);
        const c = V(0, 0, r.size.z / 2), a = c.clone().applyAxisAngle(Y, h.startYaw), b = c.clone().applyAxisAngle(Y, yawN);
        r.holder.position.x = clamp(h.startHolder.x + d.x + a.x - b.x, -2.0, 2.0);
        r.holder.position.z = clamp(h.startHolder.z + d.z + a.z - b.z, 0.04, 1.8);
        r.holder.rotation.y = yawN;
        r.holder.position.y = Math.abs(r.holder.position.x) < 0.2 && r.holder.position.z < 0.2 ? r.home.y : 0;
        shadowDirty = true;
      }
      if (H.src && !H.src.hand) {
        const t = rayTarget(H), show = t && ['tablet', 'turntable', 'mover', 'lp', 'loose'].includes(t.type) && t.distance < 6;
        H.line.scale.z = show ? t.distance : 0.3; H.line.material.opacity = show ? 0.8 : 0.25; H.dot.visible = !!show; if (show) H.dot.position.copy(t.point);
        if (t?.type === 'tablet') t.t.pointer(t.uv, H.selecting && H.uiTablet === t.t, S, uiAction);
        const hk = show ? t.type + (t.u?.v0 ?? t.mv?.name ?? t.key ?? '') : null; if (hk !== H.hover) { H.hover = hk; if (hk) haptic(H, 0.12, 8); }
      } else if (H.src && H.src.hand) {
        const tip = H.hand.joints['index-finger-tip'];
        if (tip) for (const tb of tablets) {
          const loc = tb.screen.worldToLocal(tip.getWorldPosition(V()));
          if (Math.abs(loc.x) < tb.w / 2 && Math.abs(loc.y) < tb.h / 2 && loc.z < 0.012 && loc.z > -0.03) { tb.pointer(new THREE.Vector2(loc.x / tb.w + 0.5, loc.y / tb.h + 0.5), true, S, uiAction); H.poking = tb; }
          else if (H.poking === tb) { tb.pointer(null, false, S, uiAction); H.poking = null; }
        }
      }
      const gp = H.src?.gamepad;
      if (gp && gp.axes.length >= 4) {
        const ax = gp.axes[2], ay = gp.axes[3];
        if (H.src.handedness === 'left' && Math.hypot(ax, ay) > 0.15) {
          const f = camera.getWorldDirection(V()); f.y = 0; f.normalize(); const rgt = V().crossVectors(f, Y);
          rig.position.addScaledVector(f, -ay * 1.5 * dt).addScaledVector(rgt, ax * 1.5 * dt);
        }
        if (H.src.handedness === 'right') {
          if (Math.abs(ax) > 0.7 && snapReady[H.i]) { snapReady[H.i] = false; const c = camera.getWorldPosition(V()), a = -Math.sign(ax) * Math.PI / 6; rig.position.sub(c).applyAxisAngle(Y, a).add(c); rig.rotation.y += a; }
          if (Math.abs(ax) < 0.3) snapReady[H.i] = true;
        }
      }
    }
    const cw = camera.getWorldPosition(V()), lx = ROOM.W / 2 - 0.3, lz = ROOM.D / 2 - 0.3;
    if (Math.abs(cw.x) > lx) rig.position.x -= cw.x - Math.sign(cw.x) * lx;
    if (Math.abs(cw.z) > lz) rig.position.z -= cw.z - Math.sign(cw.z) * lz;
  } else {
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    const f = V(-Math.sin(yaw), 0, -Math.cos(yaw)), rgt = V(Math.cos(yaw), 0, -Math.sin(yaw)), sp = 1.8 * dt;
    if (keys.KeyW || keys.ArrowUp) rig.position.addScaledVector(f, sp); if (keys.KeyS || keys.ArrowDown) rig.position.addScaledVector(f, -sp);
    if (keys.KeyA || keys.ArrowLeft) rig.position.addScaledVector(rgt, -sp); if (keys.KeyD || keys.ArrowRight) rig.position.addScaledVector(rgt, sp);
    rig.position.x = clamp(rig.position.x, -ROOM.W / 2 + 0.3, ROOM.W / 2 - 0.3); rig.position.z = clamp(rig.position.z, -ROOM.D / 2 + 0.3, ROOM.D / 2 - 0.3);
    if (deskHeld) { camera.updateMatrixWorld(); const p = V(0.1, -0.12, -0.45).applyMatrix4(camera.matrixWorld), q = camera.getWorldQuaternion(new THREE.Quaternion()); deskHeld.phys.moveTo(p, q); deskHeld.mesh.position.copy(p); deskHeld.mesh.quaternion.copy(q); shadowDirty = true; }
  }
  // physics: furniture follows its meshes, records and ceramics follow their bodies
  for (const f of followers) f.sync();
  PHYS.step(dt);
  for (const l of loose) if (!l.held && !l.phys.sleeping()) {
    l.phys.syncMesh(); shadowDirty = true;
    // settle: once nearly still for half a second, put it to sleep (no micro-rocking on uneven tops)
    const b = l.phys.body, v = b.linvel(), w = b.angvel();
    l.calm = Math.hypot(v.x, v.y, v.z) < 0.06 && Math.hypot(w.x, w.y, w.z) < 2.5 ? (l.calm || 0) + dt : 0;
    if (l.calm > 0.5) { b.setLinvel({ x: 0, y: 0, z: 0 }, false); b.setAngvel({ x: 0, y: 0, z: 0 }, false); b.sleep(); l.calm = 0; }
  }
  if ((uiTick += dt) > 1) { uiTick = 0; S.clock = fmtH(S.hour); tablets.forEach(t => t.draw(S)); }
  if (shadowDirty) { renderer.shadowMap.needsUpdate = true; shadowDirty = false; }
  renderer.render(scene, camera);
}
S.clock = fmtH(S.hour); tablets.forEach(t => t.draw(S));
renderer.setAnimationLoop(frame);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ════════════════════════════════════════════════════════════════════ entry
$('#loading').classList.add('done');
let revealed = false; const reveal = () => { if (revealed) return; revealed = true; S.hour = 21.8; S.hourTarget = 17.6; tablets.forEach(t => t.draw(S)); };
setTimeout(reveal, 1800);
const vrb = VRButton.createButton(renderer, { optionalFeatures: ['hand-tracking', 'local-floor', 'bounded-floor', 'layers'] });
vrb.id = 'vrbtn'; $('#enter').appendChild(vrb);
renderer.xr.addEventListener('sessionstart', () => { ensureAudio(); camera.position.set(0, 0, 0); $('#hud').classList.add('hidden'); revealed = false; reveal(); });
renderer.xr.addEventListener('sessionend', () => { camera.position.set(0, 1.62, 0); $('#hud').classList.remove('hidden'); });
window.APP = { scene, renderer, camera, rig, pieces, movers, lpUnits, loose, S, uiAction, togglePlay, tablets, pick, raycaster, deskClick, PHYS, setView(x, z, y, p) { rig.position.set(x, S.floor, z); yaw = y; pitch = p ?? pitch; } };
