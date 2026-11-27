"use client";

import { useCallback, useState } from "react";
import * as three from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { readMesh } from "@/lib/evidence/mesh";

// The renderer owns everything it mounts. Resize, drag and keyboard input are the only redraws.
function mountModel(node: HTMLDivElement, mesh: ReturnType<typeof readMesh>, name: string) {
  const summary = mesh.vertices.length + " vertices · " + mesh.triangles.length / 3 + " faces";
  let renderer;
  try { renderer = new three.WebGLRenderer({antialias: true, alpha: true}); }
  catch { return { status: summary + " · WebGL is unavailable. Download the OBJ to inspect it offline." }; }
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", name + ". Rotate with the arrow keys or drag. Press Home to reset.");
  canvas.className = "block w-full h-full rounded-lg focus-visible:outline-2 focus-visible:outline-ring";
  node.appendChild(canvas);
  const geometry = new three.BufferGeometry();
  geometry.setAttribute("position", new three.Float32BufferAttribute(mesh.triangles.flatMap(i => mesh.vertices[i]), 3));
  geometry.center();
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const radius = Math.max(geometry.boundingSphere!.radius, 0.00001);
  geometry.scale(1/radius, 1/radius, 1/radius);
  const material = new three.MeshStandardMaterial({color: 0x72a9ac, roughness: .68, metalness: .15, side: three.DoubleSide, flatShading: true});
  const scene = new three.Scene();
  const object = new three.Mesh(geometry, material);
  scene.add(object, new three.HemisphereLight(0xf0ffff, 0x506773, 1.7));
  const key = new three.DirectionalLight(0xfff5de, 2.1);
  key.position.set(3, 6, 4);
  scene.add(key);
  const camera = new three.PerspectiveCamera(33, 1, 0.03, 40);
  camera.position.set(1.8, 1.45, 2.8);
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.minDistance = 1.35;
  controls.maxDistance = 8;
  controls.update();
  controls.saveState();
  const draw = () => renderer.render(scene, camera);
  const keyboard = (e: KeyboardEvent) => {
    if (!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home"].includes(e.key)) return;
    e.preventDefault();
    if (e.key === "Home") controls.reset();
    else {
      const orbit = new three.Spherical().setFromVector3(camera.position);
      if (e.key === "ArrowLeft") orbit.theta -= .15;
      if (e.key === "ArrowRight") orbit.theta += .15;
      if (e.key === "ArrowUp") orbit.phi -= .15;
      if (e.key === "ArrowDown") orbit.phi += .15;
      orbit.makeSafe();
      camera.position.setFromSpherical(orbit);
      controls.update();
    }
  };
  const resize = new ResizeObserver(() => {
    const {width, height} = node.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    draw();
  });
  controls.addEventListener("change", draw);
  canvas.addEventListener("keydown", keyboard);
  resize.observe(node);
  return { status: summary + " · Drag or use arrow keys to rotate.", dispose: () => {
    resize.disconnect();
    controls.dispose();
    canvas.removeEventListener("keydown", keyboard);
    geometry.dispose(); material.dispose(); renderer.dispose(); canvas.remove();
  } };
}

async function loadModel(url: string, signal: AbortSignal) {
  const response = await fetch(url, {signal});
  if (!response.ok) throw Error("The model could not be loaded.");
  return readMesh(await response.text());
}

export default function ModelPreview({ url, name }: { url: string; name: string }) {
  const [status, setStatus] = useState("Loading model…");
  const attach = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const request = new AbortController();
    let release: (() => void) | undefined;
    loadModel(url, request.signal).then(mesh => {
      if (request.signal.aborted) return;
      const scene = mountModel(node, mesh, name);
      release = scene.dispose;
      setStatus(scene.status);
    }).catch(() => {
      if (!request.signal.aborted) setStatus("The model preview is unavailable.");
    });
    return () => { request.abort(); release?.(); };
  }, [url, name]);
  return <figure className="min-w-0">
    <div ref={attach} className="h-[min(42dvh,24rem)] min-h-48 w-full min-w-0 rounded-lg bg-muted" />
    <figcaption role="status" className="mt-1 text-xs text-muted-foreground">{status}</figcaption>
  </figure>;
}
