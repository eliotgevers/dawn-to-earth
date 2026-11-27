"use client";

import { useEffect, useEffectEvent, useId, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

type Point = [number, number, number];

export type SceneModel<T> = {
  root: THREE.Object3D;
  update: (state: T) => void;
  camera?: Point;
  target?: Point;
  minDistance?: number;
  maxDistance?: number;
  dispose?: () => void;
};

type MountedScene<T> = { model: SceneModel<T>; draw: () => void; detach: () => void };

function mountScene<T>(el: HTMLCanvasElement, create: (redraw: () => void) => SceneModel<T>, initial: T,
  pick: (id: string) => void, availability: (available: boolean) => void): MountedScene<T> | undefined {
  let renderer: THREE.WebGLRenderer;
  try {
    const context = el.getContext("webgl2", { antialias: true, alpha: true, depth: true, powerPreference: "low-power" });
    if (!context) { availability(false); return; }
    renderer = new THREE.WebGLRenderer({ canvas: el, context, alpha: true });
  } catch {
    availability(false);
    return;
  }
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
  let disposed = false;
  function draw() { if (!disposed) renderer.render(scene, camera); }
  const model = create(draw);
  scene.add(model.root, new THREE.AmbientLight(0xffffff, 1.05));
  const sun = new THREE.DirectionalLight(0xfff7e8, 2.0);
  sun.position.set(-3, 4, 5);
  scene.add(sun);
  camera.position.set(...(model.camera ?? [0, 0, 3.65] as Point));
  const orbit = new OrbitControls(camera, el);
  orbit.enablePan = false;
  orbit.target.set(...(model.target ?? [0, 0, 0] as Point));
  orbit.minDistance = model.minDistance ?? 1.55;
  orbit.maxDistance = model.maxDistance ?? 8;
  orbit.update();
  orbit.saveState();
  orbit.addEventListener("change", draw);
  model.update(initial);

  function resize() {
    const { clientWidth: width, clientHeight: height } = el;
    if (!width || !height) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Keep the landscape composition in frame on phones without resetting the user's orbit or zoom.
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(21)) * Math.max(1, 1.45 / camera.aspect)));
    camera.updateProjectionMatrix();
    draw();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(el);
  resize();

  let start: { x: number; y: number } | null = null;
  let dragging = false;
  function down(e: PointerEvent) {
    if (!e.isPrimary) { dragging = true; return; }
    dragging = false;
    start = { x: e.clientX, y: e.clientY };
  }
  function move(e: PointerEvent) {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) dragging = true;
  }
  function up(e: PointerEvent) {
    if (!e.isPrimary || !start) return;
    start = null;
    if (dragging) return;
    const box = el.getBoundingClientRect();
    const pointer = new THREE.Vector2((e.clientX - box.left) / box.width * 2 - 1, 1 - (e.clientY - box.top) / box.height * 2);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer, camera);
    ray.params.Points.threshold = 0.014;
    ray.params.Line.threshold = 0.025;
    const hit = ray.intersectObject(model.root, true).find(hit => {
      for (let obj: THREE.Object3D | null = hit.object; obj; obj = obj.parent)
        if (!obj.visible || obj.userData.ignorePick) return false;
      return true;
    });
    const pointId = hit?.index === undefined ? undefined : hit.object.userData.pickIds?.[hit.index];
    if (typeof pointId === "string") { pick(pointId); return; }
    for (let obj: THREE.Object3D | null = hit?.object ?? null; obj; obj = obj.parent) {
      if (typeof obj.userData.pickId === "string") { pick(obj.userData.pickId); break; }
    }
  }
  function cancel() { start = null; }
  function key(e: KeyboardEvent) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const spherical = new THREE.Spherical().setFromVector3(camera.position.clone().sub(orbit.target));
    switch (e.key) {
      case "ArrowLeft": spherical.theta -= 0.16; break;
      case "ArrowRight": spherical.theta += 0.16; break;
      case "ArrowUp": spherical.phi -= 0.14; break;
      case "ArrowDown": spherical.phi += 0.14; break;
      case "+": case "=": spherical.radius /= 1.16; break;
      case "-": spherical.radius *= 1.16; break;
      case "Home": e.preventDefault(); orbit.reset(); return;
      default: return;
    }
    e.preventDefault();
    spherical.makeSafe();
    spherical.radius = THREE.MathUtils.clamp(spherical.radius, orbit.minDistance, orbit.maxDistance);
    camera.position.copy(orbit.target).add(new THREE.Vector3().setFromSpherical(spherical));
    orbit.update();
  }
  function lost(e: Event) { e.preventDefault(); availability(false); }
  function restore() { availability(true); resize(); }
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", cancel);
  el.addEventListener("keydown", key);
  el.addEventListener("webglcontextlost", lost);
  el.addEventListener("webglcontextrestored", restore);
  availability(true);
  return { model, draw, detach() {
    disposed = true;
    observer.disconnect();
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", cancel);
    el.removeEventListener("keydown", key);
    el.removeEventListener("webglcontextlost", lost);
    el.removeEventListener("webglcontextrestored", restore);
    orbit.dispose();
    model.dispose?.();
    const resources = new Set<{dispose: () => void}>();
    model.root.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) resources.add(mesh.geometry);
      for (const material of [mesh.material].flat()) {
        if (!material) continue;
        resources.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) resources.add(value);
      }
    });
    for (const resource of resources) resource.dispose();
    renderer.dispose();
  } };
}

/** Each study supplies its own geometry. The viewport owns camera input, depth picking and GPU lifetime. */
export function StudyScene<T>({ label, create, state, onPick, fallback, className }: {
  label: string;
  create: (redraw: () => void) => SceneModel<T>;
  state: T;
  onPick?: (id: string) => void;
  fallback: ReactNode;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const active = useRef<MountedScene<T> | undefined>(undefined);
  const alternative = useRef<HTMLDivElement>(null);
  const help = useId();
  const instructions = useRef<HTMLSpanElement>(null);
  const pick = useEffectEvent((id: string) => onPick?.(id));
  const initial = useEffectEvent(() => state);

  useEffect(() => {
    const el = canvas.current;
    const other = alternative.current;
    if (!el || !other) return;
    const mounted = mountScene(el, create, initial(), pick, available => {
      el.hidden = !available;
      other.hidden = available;
      if (instructions.current) instructions.current.hidden = !available;
    });
    active.current = mounted;
    return () => { mounted?.detach(); active.current = undefined; };
  }, [create]);

  useEffect(() => {
    active.current?.model.update(state);
    active.current?.draw();
  }, [state]);

  return <div className={className}>
    <canvas ref={canvas} hidden tabIndex={0} aria-roledescription="interactive 3D view" aria-label={label} aria-describedby={help}
      className="block h-full w-full cursor-grab touch-none outline-offset-[-3px] active:cursor-grabbing" />
    <span ref={instructions} hidden id={help} className="sr-only">Drag or use arrow keys to rotate. Pinch, scroll, or use plus and minus to zoom. Home resets the view.</span>
    <div ref={alternative} hidden className="h-full w-full">{fallback}</div>
  </div>;
}
