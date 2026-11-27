import * as THREE from "three";

// Reference basemap: the June 2004 Blue Marble relief mosaic with the archived 2002 Blue Marble cloud composite.
export const mapUrl = "/fleet/blue-marble-atlas.webp";

export function createEarth(redraw: () => void, onMapError: () => void, onMapReady: () => void) {
  const root = new THREE.Group();
  let disposed = false;
  let globe: import("three-globe").default | undefined;
  root.visible = false;
  Promise.all([import("three-globe"), new THREE.TextureLoader().loadAsync(mapUrl)])
    .then(([{ default: ThreeGlobe }, texture]) => {
      if (disposed) { texture.dispose(); return; }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      const surface = new THREE.MeshPhongMaterial({ map: texture, specular: 0x16252a, shininess: 18 });
      globe = new ThreeGlobe({ animateIn: false, waitForGlobeReady: false })
        .globeCurvatureResolution(2).globeMaterial(surface)
        .atmosphereAltitude(0.024).atmosphereColor("#75b5d5").pauseAnimation();
      // The geographic layer puts Greenwich on +Z and east on +X. Match its radius to the catalog.
      globe.scale.setScalar(1 / globe.getGlobeRadius());
      root.add(globe);
      root.visible = true;
      onMapReady();
      requestAnimationFrame(() => { if (!disposed) redraw(); });
    })
    .catch(() => { if (!disposed) onMapError(); });
  return { root, dispose() { disposed = true; globe?._destructor(); } };
}
