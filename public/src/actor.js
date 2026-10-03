import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const sharedMats = new Map();
/** Materials shared by `shared: true` actors (they outlive any one scene). */
export function sharedActorMaterials() { return [...sharedMats.values()]; }

/**
 * A rigged KayKit character with animation helpers, hand slots and hit flash.
 * `shared: true` makes every actor of the same character + tint use one material per mesh (crowds of
 * villagers); the first hitFlash() then gives that actor its own copies.
 */
export class Actor {
  constructor(assets, charName, { tint = null, scale = 1, shared = false } = {}) {
    this.assets = assets;
    this.root = new THREE.Group();
    this.model = SkeletonUtils.clone(assets.chars[charName]);
    this.model.scale.setScalar(scale);
    this.meshes = [];
    this.model.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true; o.frustumCulled = false;
        if (shared) {
          const key = `${o.material.uuid}|${tint ? tint.getHex() : ''}`;
          let m = sharedMats.get(key);
          if (!m) { m = o.material.clone(); if (tint) m.color.multiply(tint); sharedMats.set(key, m); }
          o.material = m;
        } else {
          o.material = o.material.clone();
          if (tint) o.material.color.multiply(tint);
        }
        this.meshes.push(o);
      }
    });
    this.root.add(this.model);
    // GLTFLoader strips dots from node names: "handslot.r" -> "handslotr"
    this.handR = this.model.getObjectByName('handslotr');
    this.handL = this.model.getObjectByName('handslotl');

    this.mixer = new THREE.AnimationMixer(this.model);
    // actions are created on first use (about 26 clips exist, most actors only ever play a few)
    const mixer = this.mixer, made = {};
    this.actions = new Proxy(made, { get: (t, n) => typeof n !== 'string' ? undefined : (t[n] ||= assets.clips[n] ? mixer.clipAction(assets.clips[n]) : undefined) });
    this.cur = null; this.base = null; this.busy = 0; this.dead = false; this.flash = 0; this.lit = 0; this.sharedMats = shared;
  }

  /** Attach a prop (weapon/shield) to a hand slot. */
  hold(propName, hand = 'R') {
    const slot = hand === 'R' ? this.handR : this.handL;
    const p = this.assets.props[propName].clone(true);
    p.traverse(o => { if (o.isMesh) o.castShadow = true; });
    slot.add(p);
    return p;
  }

  setBase(name) {
    if (this.dead || this.busy > 0 || this.base === name) return;
    const next = this.actions[name];
    next.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveTimeScale(1).fadeIn(0.15).play();
    if (this.cur && this.cur !== next) this.cur.fadeOut(0.15);
    this.cur = next; this.base = name;
  }

  once(name, { speed = 1, hold = false } = {}) {
    if (this.dead) return 0;
    const a = this.actions[name];
    a.reset().setLoop(THREE.LoopOnce, 1).setEffectiveTimeScale(speed);
    a.clampWhenFinished = hold;
    a.fadeIn(0.08).play();
    if (this.cur && this.cur !== a) this.cur.fadeOut(0.08);
    this.cur = a; this.base = null;
    this.busy = a.getClip().duration / speed;
    if (hold) this.dead = true;
    return this.busy;
  }

  hitFlash() {
    if (this.sharedMats) { this.sharedMats = false; for (const m of this.meshes) m.material = m.material.clone(); }
    this.flash = 0.18;
  }

  update(dt) {
    this.mixer.update(dt);
    if (this.busy > 0) this.busy -= dt;
    this.flash = Math.max(0, this.flash - dt);
    const e = this.flash > 0 ? 0.9 : 0;
    if (e !== this.lit) { this.lit = e; for (const m of this.meshes) m.material.emissive.setRGB(e, e * 0.15, e * 0.15); }
  }
}

/** Turn `current` toward `target` angle by at most `maxStep` radians. */
export function turnToward(current, target, maxStep) {
  let d = ((target - current + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return current + Math.max(-maxStep, Math.min(maxStep, d));
}
