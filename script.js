// Replace with your Mapbox access token
mapboxgl.accessToken = 'pk.eyJ1IjoiYXBwcy1sYXNjYWRlIiwiYSI6ImNsbGtwaWpqaTI4ZHUza3FoMDdhZWtiNWkifQ.pSE_wiDz_j67iJKIPAkrtA';

// Query parameters
const params = new URLSearchParams(window.location.search);
const forceFetchAll = params.has('fetch_all');
const disableClustering = params.has('no_clustering');

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v11',
  center: [0, 0],
  zoom: 2
});

const shipsCache = new Map();
let currentFetchId = 0;

const toggleBtn = document.getElementById('cluster-toggle');
if (toggleBtn) {
  toggleBtn.title = disableClustering ? 'Enable clustering' : 'Disable clustering';
  toggleBtn.textContent = disableClustering ? 'C+' : 'C-';
  toggleBtn.addEventListener('click', () => {
    const params = new URLSearchParams(window.location.search);
    if (disableClustering) {
      params.delete('no_clustering');
    } else {
      params.set('no_clustering', '');
    }
    window.location.search = params.toString();
  });
}

map.on('load', () => {
  map.addSource('ships', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    cluster: !disableClustering,
    clusterRadius: 40,
    clusterMaxZoom: 10
  });

  if (!disableClustering) {
    map.addLayer({
      id: 'clusters',
      type: 'circle',
      source: 'ships',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#51bbd6',
        'circle-radius': ['step', ['get', 'point_count'], 15, 100, 20, 750, 25]
      }
    });

    map.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: 'ships',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': '{point_count_abbreviated}',
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        'text-size': 12
      }
    });
  }

  map.addLayer({
    id: 'unclustered-point',
    type: 'circle',
    source: 'ships',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': '#f28cb1',
      'circle-radius': 6
    }
  });

  if (disableClustering) {
    map.on('moveend', () => {
      updateSource();
      scheduleFetch();
    });
  } else {
    map.on('moveend', scheduleFetch);
  }

  map.on('click', 'unclustered-point', (e) => {
    const props = e.features[0].properties;
    const coordinates = e.features[0].geometry.coordinates.slice();
    const info = `MMSI: ${props.mmsi}<br>Name: ${props.name || 'N/A'}<br>Speed: ${props.speed || 'N/A'}`;
    new mapboxgl.Popup()
      .setLngLat(coordinates)
      .setHTML(info)
      .addTo(map);
  });

  loadShips();
});

// IndexedDB setup
const dbPromise = new Promise((resolve, reject) => {
  const request = indexedDB.open('ships-db', 1);
  request.onupgradeneeded = (e) => {
    e.target.result.createObjectStore('ships', { keyPath: 'mmsi' });
  };
  request.onsuccess = (e) => resolve(e.target.result);
  request.onerror = (e) => reject(e.target.error);
});

async function loadCachedShips() {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('ships', 'readonly');
    const store = tx.objectStore('ships');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function saveShip(ship) {
  dbPromise.then(db => {
    const tx = db.transaction('ships', 'readwrite');
    tx.objectStore('ships').put(ship);
  });
}

async function loadShips() {
  try {
    const cached = await loadCachedShips();
    if (forceFetchAll || cached.length === 0) {
      await fetchAllShips();
    } else {
      for (const ship of cached) {
        if (!ship.location ||
            !Array.isArray(ship.location.coordinates) ||
            ship.location.coordinates.length !== 2 ||
            ship.location.coordinates.some(n => Number.isNaN(n))) {
          continue;
        }
        shipsCache.set(ship.mmsi, toFeature(ship));
      }
    }
    updateSource();
    scheduleFetch();
  } catch (err) {
    console.error('Failed to load ships', err);
  }
}

async function fetchAllShipsFromCSV() {
  const url = 'https://staging.ship.lascade.com/static/ships_data_dump.csv';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Network response was not ok');
  const text = await res.text();
  const lines = text.trim().split('\n');
  lines.shift(); // header
  for (const line of lines) {
    const parts = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(s => s.replace(/^"|"$/g, ''));
    const [mmsi, type_name, type_value, country, location, name, imo_number, course, speed, heading] = parts;
    const [lon, lat] = location.split(',').map(Number);
    if (Number.isNaN(lon) || Number.isNaN(lat)) {
      continue;
    }
    const ship = {
      mmsi: Number(mmsi),
      type: type_name || null,
      country: country || null,
      location: { type: 'Point', coordinates: [lon, lat] },
      name: name || null,
      imo_number: imo_number ? Number(imo_number) : null,
      course: parseFloat(course),
      speed: parseFloat(speed),
      heading: heading ? parseFloat(heading) : null
    };
    shipsCache.set(ship.mmsi, toFeature(ship));
    saveShip(ship);
  }
}

async function fetchAllShipsFromAPI() {
  let url = 'https://staging.ship.lascade.com/ships/within_radius/';
  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Network response was not ok');
    const data = await res.json();
    for (const ship of data.results) {
      if (!ship.location ||
          !Array.isArray(ship.location.coordinates) ||
          ship.location.coordinates.length !== 2) {
        continue;
      }
      shipsCache.set(ship.mmsi, toFeature(ship));
      saveShip(ship);
    }
    url = data.next;
  }
}

async function fetchAllShips() {
  try {
    await fetchAllShipsFromCSV();
  } catch (err) {
    console.warn('CSV download failed, falling back to API', err);
    await fetchAllShipsFromAPI();
  }
}

function toFeature(ship) {
  return {
    type: 'Feature',
    geometry: ship.location,
    properties: {
      mmsi: ship.mmsi,
      name: ship.name,
      speed: ship.speed,
      course: ship.course
    }
  };
}

function updateSource() {
  const source = map.getSource('ships');
  if (source) {
    let features = Array.from(shipsCache.values());
    if (disableClustering) {
      const bounds = map.getBounds();
      features = features.filter(f => {
        const [lon, lat] = f.geometry.coordinates;
        return lon >= bounds.getWest() && lon <= bounds.getEast() &&
               lat >= bounds.getSouth() && lat <= bounds.getNorth();
      }).slice(0, 1000);
    }
    source.setData({
      type: 'FeatureCollection',
      features
    });
  }
}

function calculateRadius(center, bounds) {
  const R = 6371; // earth radius in km
  const lat1 = center.lat * Math.PI / 180;
  const lon1 = center.lng * Math.PI / 180;
  const lat2 = bounds.getNorthEast().lat * Math.PI / 180;
  const lon2 = bounds.getNorthEast().lng * Math.PI / 180;
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function shipsInViewport() {
  const bounds = map.getBounds();
  let count = 0;
  for (const f of shipsCache.values()) {
    const [lon, lat] = f.geometry.coordinates;
    if (lon >= bounds.getWest() && lon <= bounds.getEast() &&
        lat >= bounds.getSouth() && lat <= bounds.getNorth()) {
      count++;
    }
  }
  return count;
}

function scheduleFetch() {
  const fetchId = ++currentFetchId;
  setTimeout(() => fetchShipsInView(fetchId), 300);
}

async function fetchShipsInView(fetchId) {
  const center = map.getCenter();
  const bounds = map.getBounds();
  const radius = calculateRadius(center, bounds);
  let next = `https://staging.ship.lascade.com/ships/within_radius/?latitude=${center.lat}&longitude=${center.lng}&radius=${radius}`;

  const loadPage = async () => {
    if (!next || fetchId !== currentFetchId) return;
    const res = await fetch(next);
    if (!res.ok) return;
    const data = await res.json();
    next = data.next;
    for (const ship of data.results) {
      if (!ship.location ||
          !Array.isArray(ship.location.coordinates) ||
          ship.location.coordinates.length !== 2) {
        continue;
      }
      shipsCache.set(ship.mmsi, toFeature(ship));
      saveShip(ship);
    }
    updateSource();
    if (next && fetchId === currentFetchId) {
      setTimeout(loadPage, 500);
    }
  };

  loadPage();
}
