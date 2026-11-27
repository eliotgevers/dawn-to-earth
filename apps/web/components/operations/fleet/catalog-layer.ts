import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type { SceneModel } from "@/components/operations/study-scene";
import { createEarth } from "./globe";
import type { OrbitFrame } from "@/lib/orbital-estimates";

export type SkyState = { frame: OrbitFrame | null; selected: number | null; dark: boolean };

function geometry() {
  const shape = new THREE.BufferGeometry();
  shape.setAttribute("position", new THREE.BufferAttribute(new Float32Array(), 3));
  return shape;
}

function coordinates(shape: THREE.BufferGeometry, coords: Float32Array) {
  let attr = shape.getAttribute("position") as THREE.BufferAttribute;
  if (attr.array.length !== coords.length) {
    shape.dispose();
    attr = new THREE.BufferAttribute(new Float32Array(coords.length), 3).setUsage(THREE.DynamicDrawUsage);
    shape.setAttribute("position", attr);
  }
  attr.copyArray(coords);
  attr.needsUpdate = true;
  shape.boundingSphere = null;
}

function points(size: number) {
  const material = new THREE.PointsMaterial({ size, sizeAttenuation: false, depthWrite: false });
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <clipping_planes_fragment>",
      "#include <clipping_planes_fragment>\nif(distance(gl_PointCoord, vec2(0.5)) > 0.5) discard;");
  };
  const result = new THREE.Points(geometry(), material);
  result.frustumCulled = false;
  return result;
}

export function createSky(redraw: () => void, ready: () => void, failed: () => void): SceneModel<SkyState> {
  let activeCamera: THREE.Camera | undefined, lastFocus: number | null = null;
  let pending: SkyState | undefined;
  const earth = createEarth(redraw, () => { failed(); }, () => { ready(); redraw(); });
  const fleet = points(7), marked = points(11);
  const arc = new Line2(new LineGeometry(), new LineMaterial({ color: 0xffbe55, linewidth: 3, depthWrite: false }));
  arc.raycast = () => {};
  arc.visible = false;
  arc.userData.ignorePick = true;
  arc.frustumCulled = false;
  // The opaque Earth supplies depth before overlays draw; the far side remains occluded.
  arc.renderOrder = 1;
  fleet.renderOrder = 2;
  marked.renderOrder = 3;
  earth.root.add(arc, fleet, marked);
  fleet.onBeforeRender = (_renderer, _scene, camera) => {
    if (activeCamera === camera) return;
    activeCamera = camera;
    // The first update can precede both texture loading and camera creation.
    requestAnimationFrame(() => { if (pending) { focus(pending); redraw(); } });
  };
  function focus(next: SkyState) {
    if (!next.selected) { lastFocus = null; return; }
    const i = next.frame?.ids.indexOf(next.selected) ?? -1;
    if (i < 0 || !next.frame || !activeCamera || lastFocus === next.selected) return;
    const position = new THREE.Vector3().fromArray(next.frame.xyz, 3 * i);
    const source = new THREE.Spherical().setFromVector3(position);
    const view = new THREE.Spherical().setFromVector3(activeCamera.position);
    earth.root.rotation.set(0, view.theta, 0);
    earth.root.rotateX(view.phi - source.phi);
    earth.root.rotateY(-source.theta);
    if (activeCamera.position.length() < position.length() + 0.7) activeCamera.position.setLength(position.length() + 2.1);
    lastFocus = next.selected;
  }
  const none = new Float32Array();
  return {
    root: earth.root, camera: window.matchMedia("(max-width: 767px)").matches ? [0.49, 0.64, 2.36] : [0.7, 0.92, 3.35],
    minDistance: 1.45, maxDistance: 18,
    update(next) {
      pending = next;
      const frame = next.frame, i = frame && next.selected !== null ? frame.ids.indexOf(next.selected) : -1;
      coordinates(fleet.geometry, frame?.xyz ?? none);
      coordinates(marked.geometry, frame && i >= 0 ? frame.xyz.subarray(i * 3, i * 3 + 3) : none);
      const path = frame?.path ?? none;
      arc.visible = path.length >= 6;
      if (arc.visible) {
        const geometry = arc.geometry;
        if (geometry.getAttribute("instanceStart")?.count !== path.length / 3 - 1) geometry.setPositions(path);
        else {
          const start = geometry.getAttribute("instanceStart"), end = geometry.getAttribute("instanceEnd");
          for (let j = 0; j < start.count; j++) {
            start.setXYZ(j, path[3*j], path[3*j+1], path[3*j+2]);
            end.setXYZ(j, path[3*j+3], path[3*j+4], path[3*j+5]);
          }
          start.needsUpdate = true;
          end.needsUpdate = true;
        }
      }
      fleet.userData.pickIds = frame ? Array.from(frame.ids, String) : [];
      marked.userData.pickIds = i >= 0 ? [String(next.selected)] : [];
      fleet.material.color.set(next.dark ? 0xcdeaf4 : 0x127897);
      marked.material.color.set(0xffa83c);
      arc.material.color.set(next.dark ? 0xffcb73 : 0xf59b26);
      focus(next);
    },
    dispose() { pending = undefined; earth.dispose(); },
  };
}
