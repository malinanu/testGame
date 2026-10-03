// Anno-style strategy camera (pan / rotate / zoom that tilts from street view to overview) and a
// third-person follow mode for the hero, with smooth transitions between them.
import * as THREE from 'three';
import { W, H, TILE } from './data.js';

const lerp = (a, b, t) => a + (b - a) * t;

export class RTSCamera {
  constructor(camera, dom) {
    this.cam = camera; this.dom = dom;
    this.target = new THREE.Vector3(0, 0, 0); this.goal = this.target.clone();
    this.yaw = 0.6; this.yawGoal = 0.6;
    this.zoom = 0.45; this.zoomGoal = 0.45;   // 0 = street level, 1 = overview
    this.keys = {}; this.edge = { x: 0, y: 0 }; this.drag = null;
    this.mode = 'rts'; this.follow = null; this.blend = 0;
    this.heroYaw = 0; this.heroPitch = 0.82; this.heroDist = 13;
    addEventListener('keydown', e => { if (e.target.tagName !== 'INPUT') this.keys[e.code] = true; if (e.code === 'KeyQ') { if (this.mode === 'rts') this.yawGoal += Math.PI / 4; else this.heroYawGoal = (this.heroYawGoal ?? this.heroYaw) + Math.PI / 4; } if (e.code === 'KeyE' && this.mode === 'rts') this.yawGoal -= Math.PI / 4; if (e.code === 'KeyR' && this.mode === 'hero') this.heroYawGoal = (this.heroYawGoal ?? this.heroYaw) - Math.PI / 4; });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; this.edge = { x: 0, y: 0 }; });
    dom.addEventListener('wheel', e => {
      if (this.mode === 'rts') this.zoomGoal = THREE.MathUtils.clamp(this.zoomGoal + e.deltaY * 0.0009, 0, 1);
      else this.heroDist = THREE.MathUtils.clamp(this.heroDist + e.deltaY * 0.008, 7, 24);
    }, { passive: true });
    dom.addEventListener('pointerdown', e => { if (e.button === 1 || e.button === 2) this.drag = { x: e.clientX, y: e.clientY, b: e.button }; });
    addEventListener('pointerup', () => { this.drag = null; });
    addEventListener('pointermove', e => {
      if (this.drag) {
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y; this.drag.x = e.clientX; this.drag.y = e.clientY;
        if (this.mode === 'rts') { this.yawGoal -= dx * 0.006; this.yaw = this.yawGoal; this.zoomGoal = THREE.MathUtils.clamp(this.zoomGoal + dy * 0.002, 0, 1); }
        else { this.heroYaw -= dx * 0.006; this.heroPitch = THREE.MathUtils.clamp(this.heroPitch + dy * 0.004, 0.45, 1.25); }
      }
      
      const m = 6;
      this.edge.x = e.clientX < m ? -1 : e.clientX > innerWidth - m ? 1 : 0;
      this.edge.y = e.clientY < m ? -1 : e.clientY > innerHeight - m ? 1 : 0;
    });
    dom.addEventListener('pointerleave', () => { this.edge = { x: 0, y: 0 }; });
    dom.addEventListener('contextmenu', e => e.preventDefault());
  }

  get dist() { return lerp(16, 120, this.zoom ** 1.15); }
  get pitch() { return lerp(0.42, 1.12, this.zoom); }

  focus(x, z, zoom = null) { this.goal.set(x, 0, z); if (zoom != null) this.zoomGoal = zoom; }

  setHero(obj) { this.mode = obj ? 'hero' : 'rts'; this.follow = obj; if (obj) { this.heroYaw = this.yaw; this.heroYawGoal = null; } }

  update(dt, uiBusy = false) {
    if (this.mode === 'rts') {
      const k = this.keys, speed = (30 + this.dist * 0.9) * dt;
      let mx = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0), mz = (k.KeyS || k.ArrowDown ? 1 : 0) - (k.KeyW || k.ArrowUp ? 1 : 0);
      if (!uiBusy && document.hasFocus() && !this.drag) { mx += this.edge.x; mz += this.edge.y; }
      if (mx || mz) {
        const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
        // screen-right is (cos, -sin), screen-forward (away from the camera) is (-sin, -cos); W means mz = -1
        this.goal.x += (mx * c + mz * s) * speed; this.goal.z += (-mx * s + mz * c) * speed;
      }
      const lim = W * TILE / 2 - 6;
      this.goal.x = THREE.MathUtils.clamp(this.goal.x, -lim, lim); this.goal.z = THREE.MathUtils.clamp(this.goal.z, -lim, lim);
      this.target.lerp(this.goal, 1 - Math.exp(-dt * 10));
      this.yaw += (this.yawGoal - this.yaw) * (1 - Math.exp(-dt * 8));
      this.zoom += (this.zoomGoal - this.zoom) * (1 - Math.exp(-dt * 8));
    }
    // RTS pose
    const d = this.dist, p = this.pitch;
    const rts = new THREE.Vector3(this.target.x + Math.sin(this.yaw) * Math.cos(p) * d, Math.sin(p) * d, this.target.z + Math.cos(this.yaw) * Math.cos(p) * d);
    const rtsLook = this.target.clone();
    this.blend += ((this.mode === 'hero' ? 1 : 0) - this.blend) * (1 - Math.exp(-dt * 4));
    if (this.blend < 0.001 || !this.follow) {
      this.cam.position.copy(rts); this.cam.lookAt(rtsLook);
      return;
    }
    if (this.heroYawGoal != null) { this.heroYaw += (this.heroYawGoal - this.heroYaw) * (1 - Math.exp(-dt * 8)); if (Math.abs(this.heroYawGoal - this.heroYaw) < 1e-3) this.heroYawGoal = null; }
    const f = this.follow.position;
    const hero = new THREE.Vector3(f.x + Math.sin(this.heroYaw) * Math.cos(this.heroPitch) * this.heroDist, f.y + 1.4 + Math.sin(this.heroPitch) * this.heroDist, f.z + Math.cos(this.heroYaw) * Math.cos(this.heroPitch) * this.heroDist);
    const heroLook = new THREE.Vector3(f.x, f.y + 1, f.z);
    const t = this.blend * this.blend * (3 - 2 * this.blend);
    this.cam.position.lerpVectors(rts, hero, t);
    this.cam.lookAt(rtsLook.lerp(heroLook, t));
    if (this.mode === 'hero') { this.target.set(f.x, 0, f.z); this.goal.copy(this.target); this.yaw = this.yawGoal = this.heroYaw; }
  }
  /** Ground direction for WASD in hero mode (same convention as the RTS pan: camera sits at +yaw). */
  get moveYaw() { return this.heroYaw; }
}
void H;
