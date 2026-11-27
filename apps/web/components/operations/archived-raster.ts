import type { Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";

type ArchiveRaster = { south: number; west: number; north: number; east: number; width: number; image: string; geographic?: boolean };
type SiteMarker = { lat: number; lng: number; label: string };

// Load the browser-only map engine on demand and give its DOM and event handlers one owner.
export function mountArchivedRaster(element: HTMLDivElement, scene: ArchiveRaster, marker?: SiteMarker) {
  let disposed = false;
  let map: LeafletMap | undefined;
  let resize: ResizeObserver | undefined;

  import("leaflet").then(L => {
    if (disposed) return;
    const extent = L.latLngBounds([scene.south, scene.west], [scene.north, scene.east]);
    const local = L.map(element, {
      crs: scene.geographic ? L.CRS.EPSG4326 : L.CRS.EPSG3857,
      zoomControl: false, attributionControl: false, scrollWheelZoom: false,
      maxBounds: extent, maxBoundsViscosity: 1, zoomSnap: 0.25,
      // The final step displays the raster at approximately its native resolution.
      maxZoom: Math.ceil(Math.log2(scene.width * 360 / (256 * (scene.east - scene.west)))),
    });
    map = local;
    L.control.zoom({ position: "topright" }).addTo(local);
    L.control.scale({ imperial: false, position: "bottomleft", maxWidth: 90 }).addTo(local);

    function fitCrop() {
      local.invalidateSize({ pan: false });
      const zoom = local.getBoundsZoom(extent, true);
      local.setMinZoom(zoom);
      if (!local.getZoom() || local.getZoom() <= zoom) local.setView(extent.getCenter(), zoom, { animate: false });
    }
    fitCrop();
    // Keep the static, accessible image visible until Leaflet has decoded the same local file.
    L.imageOverlay(scene.image, extent, { alt: "" }).on("load", () => {
      if (!disposed) element.style.opacity = "1";
    }).addTo(local);
    if (marker) {
      const label = document.createElement("span");
      label.textContent = marker.label;
      L.circleMarker([marker.lat, marker.lng], {
        radius: 5, weight: 2, color: "white", fillColor: "#0076a8", fillOpacity: 1, interactive: false,
      }).addTo(local).bindTooltip(label, { permanent: true, direction: "right", offset: [7, 0] });
    }
    resize = new ResizeObserver(fitCrop);
    resize.observe(element);
  }).catch(() => {
    // The source and static geographic view remain usable if the interactive chunk cannot load.
  });
  return () => {
    disposed = true;
    resize?.disconnect();
    map?.remove();
    element.style.opacity = "0";
  };
}

