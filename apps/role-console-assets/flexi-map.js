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
      const layer = L.layerGroup().addTo(map);
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
          if (bounds.length) this.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
        },
        invalidate() { setTimeout(() => this.map.invalidateSize(), 60); }
      };
    }
  };
})();
