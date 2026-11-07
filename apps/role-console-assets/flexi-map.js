// Shared live-map helper (Leaflet + OpenStreetMap) for the Supervisor
// App and Manager console. Degrades honestly: if the Leaflet CDN is
// unreachable the caller renders its list fallback instead — the data
// is never hidden behind a broken map.
(function () {
  const LAGOS = [6.5244, 3.3792];

  function markerColor(row) {
    if (row.movement === "moving") return "#157a5c";
    if (row.movement === "stale") return "#6b7a75";
    if (row.battery_state === "charging") return "#1f6feb";
    return "#b97c10";
  }

  window.flexiMap = {
    available: () => typeof window.L !== "undefined",

    mount(elementId) {
      if (!this.available()) return null;
      const map = L.map(elementId, { attributionControl: true });
      map.setView(LAGOS, 11);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors"
      }).addTo(map);
      const layer = L.layerGroup().addTo(map);       // live vehicles
      const refLayer = L.layerGroup();                // static reference (hospitals) — added on demand
      return {
        map,
        update(positions, popupHtml) {
          layer.clearLayers();
          const bounds = [];
          for (const row of positions) {
            if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) continue;
            const marker = L.circleMarker([row.lat, row.lng], {
              radius: 9,
              color: "#ffffff",
              weight: 2,
              fillColor: markerColor(row),
              fillOpacity: 0.95
            });
            marker.bindPopup(popupHtml(row), { maxWidth: 260 });
            marker.addTo(layer);
            bounds.push([row.lat, row.lng]);
          }
          // The view follows the live fleet only; static reference points never
          // steal the bounds (there can be hundreds, all over Lagos).
          if (bounds.length) this.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
        },
        // Plot a static reference layer (HMO facilities). A distinct cross-pin,
        // coloured by caller. Points without finite coords are skipped silently
        // (they are reported in the admin UI, not hidden here).
        setReference(points, popupHtml, opts) {
          const options = opts || {};
          refLayer.clearLayers();
          for (const p of points) {
            if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
            const color = options.color ? options.color(p) : "#c0392b";
            const dim = p.coords_quality && p.coords_quality !== "street" && p.coords_quality !== "authoritative";
            const icon = L.divIcon({
              className: "flexi-hosp-pin",
              html: `<span style="display:flex;align-items:center;justify-content:center;width:16px;height:16px;`
                + `border-radius:4px;background:${color};color:#fff;font:700 12px/1 system-ui;`
                + `border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);${dim ? "opacity:.6;" : ""}">+</span>`,
              iconSize: [20, 20],
              iconAnchor: [10, 10]
            });
            L.marker([p.lat, p.lng], { icon }).bindPopup(popupHtml(p), { maxWidth: 260 }).addTo(refLayer);
          }
          return refLayer.getLayers().length;
        },
        showReference(on) {
          if (on) refLayer.addTo(this.map);
          else this.map.removeLayer(refLayer);
        },
        invalidate() { setTimeout(() => this.map.invalidateSize(), 60); }
      };
    }
  };
})();
