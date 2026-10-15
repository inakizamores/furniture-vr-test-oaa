// Rigid-body physics (Rapier): furniture is static/kinematic, records and ceramics are dynamic bodies.
import * as THREE from 'three';
import RAPIER from 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.19.3/rapier.mjs';

await RAPIER.init();
export const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = 1 / 90;
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

export function staticBox(hx, hy, hz, pos, quat = null, friction = 0.7) {
  const d = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(pos.x, pos.y, pos.z).setFriction(friction).setRestitution(0.05);
  if (quat) d.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
  return world.createCollider(d);
}

// a body that follows an Object3D (furniture holder or a door / drawer node); colliders are boxes in that object's space
export class Follower {
  constructor(obj) {
    this.obj = obj; obj.updateMatrixWorld(true);
    obj.matrixWorld.decompose(_p, _q, _s);
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(_p.x, _p.y, _p.z).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }));
    this.scale = _s.clone();
  }
  box(b) {         // b: THREE.Box3 in obj space; scaled into metres by the object's world scale
    const c = b.getCenter(new THREE.Vector3()).multiply(this.scale), s = b.getSize(new THREE.Vector3()).multiply(this.scale);
    if (s.x < 1e-4 || s.y < 1e-4 || s.z < 1e-4) return;
    world.createCollider(RAPIER.ColliderDesc.cuboid(s.x / 2, s.y / 2, s.z / 2).setTranslation(c.x, c.y, c.z).setFriction(0.7).setRestitution(0.05), this.body);
  }
  // kinematic only while the object moves; fixed when idle, so whatever rests on it can settle and sleep
  sync() {
    this.obj.updateMatrixWorld(true);
    if (this.last && this.last.equals(this.obj.matrixWorld)) {
      if (!this.fixed && ++this.idle > 2) { this.body.setBodyType(RAPIER.RigidBodyType.Fixed, false); this.body.setTranslation(this.pos, false); this.body.setRotation(this.rot, false); this.fixed = true; }
      return;
    }
    this.last = (this.last || new THREE.Matrix4()).copy(this.obj.matrixWorld); this.idle = 0;
    this.obj.matrixWorld.decompose(_p, _q, _s);
    this.pos = { x: _p.x, y: _p.y, z: _p.z }; this.rot = { x: _q.x, y: _q.y, z: _q.z, w: _q.w };
    if (this.fixed !== false) { this.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true); this.fixed = false; }
    this.body.setNextKinematicTranslation(this.pos); this.body.setNextKinematicRotation(this.rot);
  }
}

// dynamic body for a mesh; shape 'box' (from the geometry's bounding box) or 'hull' (convex hull of the vertices)
export class Dynamic {
  constructor(mesh, { shape = 'box', density = 600, friction = 0.6, restitution = 0.06, ccd = true } = {}) {
    this.mesh = mesh; mesh.updateMatrixWorld(true); mesh.matrixWorld.decompose(_p, _q, _s);
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(_p.x, _p.y, _p.z).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
      .setCcdEnabled(ccd).setLinearDamping(0.1).setAngularDamping(0.8));
    const g = mesh.geometry; g.computeBoundingBox();
    let d;
    if (shape === 'hull') {   // lathe props: snap to a 12-sided hull; dense coplanar base rings make the solver rock forever
      const p = g.attributes.position, pts = [], seen = new Set();
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), r = Math.hypot(x, z), seg = Math.round(Math.atan2(z, x) / (Math.PI * 2) * 12) % 12, k = seg + '_' + y.toFixed(3);
        if (seen.has(k)) continue; seen.add(k); const a = seg / 12 * Math.PI * 2; pts.push(r * Math.cos(a), y, r * Math.sin(a));
      }
      d = RAPIER.ColliderDesc.convexHull(new Float32Array(pts));
    }
    if (!d) { const b = g.boundingBox, c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3()); d = RAPIER.ColliderDesc.cuboid(Math.max(s.x / 2, 0.0015), Math.max(s.y / 2, 0.0015), Math.max(s.z / 2, 0.0015)).setTranslation(c.x, c.y, c.z); }
    this.collider = world.createCollider(d.setDensity(density).setFriction(friction).setRestitution(restitution), this.body);
    this.held = false; this.ccd = ccd;
  }
  hold(on) {          // held = kinematic; CCD must be off then or the body refuses to leave the cabinet it came from
    this.held = on;
    this.body.enableCcd(!on && this.ccd);
    this.body.setBodyType(on ? RAPIER.RigidBodyType.KinematicPositionBased : RAPIER.RigidBodyType.Dynamic, true);
  }
  moveTo(pos, quat) { this.body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z }); this.body.setNextKinematicRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }); }
  throw(v, w) { this.body.setLinvel({ x: v.x, y: v.y, z: v.z }, true); if (w) this.body.setAngvel({ x: w.x, y: w.y, z: w.z }, true); }
  place(pos, quat) { this.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true); this.body.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }, true); this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true); }
  syncMesh() {
    const t = this.body.translation(), r = this.body.rotation();
    this.mesh.position.set(t.x, t.y, t.z); this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }
  sleeping() { return this.body.isSleeping(); }
  remove() { world.removeRigidBody(this.body); }
}

let acc = 0;
export function step(dt) {
  acc += Math.min(dt, 0.05);
  let n = 0;
  while (acc >= world.timestep && n < 4) { world.step(); acc -= world.timestep; n++; }
}
