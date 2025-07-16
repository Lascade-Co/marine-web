// Replace with your Mapbox access token
mapboxgl.accessToken = 'YOUR_MAPBOX_ACCESS_TOKEN';

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

// Source setup with optional clustering
map.on('load', () => {
  map.addSource('ships', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    cluster: !disableClustering,
    clusterRadius: 40,
    clusterMaxZoom: 10
  });

  // Clustered layers if enabled
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

  // Individual ship points
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

  // Popups on click
  map.on('click', 'unclustered-point', (e) => {
    const props = e.features[0].properties;
    const coordinates = e.features[0].geometry.coordinates.slice();
    const info = `MMSI: ${props.mmsi}<br>Name: ${props.name || 'N/A'}<br>Speed: ${props.speed || 'N/A'}`;

    new mapboxgl.Popup()
      .setLngLat(coordinates)
      .setHTML(info)
      .addTo(map);
  });

  // Zoom into clusters
  if (!disableClustering) {
    map.on('click', 'clusters', (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
      const clusterId = features[0].properties.cluster_id;
      map.getSource('ships').getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err) return;
        map.easeTo({ center: features[0].geometry.coordinates, zoom });
      });
    });
  }

  // Load cached ships or fetch all on first visit
  loadCachedShips().then(async cached => {
    for (const ship of cached) {
      shipsCache.set(ship.mmsi, {
        type: 'Feature',
        geometry: ship.location,
        properties: {
          mmsi: ship.mmsi,
          name: ship.name,
          speed: ship.speed,
          course: ship.course
        }
      });
    }
    if (forceFetchAll || cached.length === 0) {
      await fetchAllShips();
    }
    updateSource();
    updateShips();
  }).catch(async () => {
    await fetchAllShips();
    updateSource();
    updateShips();
  });
  map.on('moveend', updateShips);
});

let fetchTimeout;
let stableTimeout;
let currentRequestId = 0;
const shipsCache = new Map();

// IndexedDB for persistent caching
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

function updateShips() {
  if (fetchTimeout) clearTimeout(fetchTimeout);
  if (stableTimeout) clearTimeout(stableTimeout);
  const requestId = ++currentRequestId;
  fetchTimeout = setTimeout(async () => {
    const center = map.getCenter();
    const bounds = map.getBounds();
    const radius = calculateRadius(center, bounds);

    try {
      const url = `https://staging.ship.lascade.com/ships/within_radius/?latitude=${center.lat}&longitude=${center.lng}&radius=${radius}`;
      const next = await fetchPage(url, requestId);
      schedulePagination(next, requestId);
    } catch (err) {
      console.error('Failed to load ships', err);
    }
  }, 300);
}

async function fetchPage(url, requestId) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Network response was not ok');
  const data = await res.json();
  for (const ship of data.results) {
    shipsCache.set(ship.mmsi, {
      type: 'Feature',
      geometry: ship.location,
      properties: {
        mmsi: ship.mmsi,
        name: ship.name,
        speed: ship.speed,
        course: ship.course
      }
    });
    saveShip(ship);
  }
  if (requestId === currentRequestId) {
    updateSource();
  }
  return data.next;
}

function schedulePagination(nextUrl, requestId) {
  if (!nextUrl) return;
  stableTimeout = setTimeout(() => {
    if (requestId === currentRequestId && shipsCache.size < 200) {
      loadAdditionalPages(nextUrl, requestId);
    }
  }, 1500);
}

async function loadAdditionalPages(url, requestId) {
  let next = url;
  while (next && requestId === currentRequestId && shipsCache.size < 200) {
    next = await fetchPage(next, requestId);
  }
}

// Fetch all ships from the API and cache them
async function fetchAllShips() {
  let url = 'https://staging.ship.lascade.com/ships/within_radius/';
  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Network response was not ok');
    const data = await res.json();
    for (const ship of data.results) {
      shipsCache.set(ship.mmsi, {
        type: 'Feature',
        geometry: ship.location,
        properties: {
          mmsi: ship.mmsi,
          name: ship.name,
          speed: ship.speed,
          course: ship.course
        }
      });
      saveShip(ship);
    }
    updateSource();
    url = data.next;
  }
}

function updateSource() {
  map.getSource('ships').setData({
    type: 'FeatureCollection',
    features: Array.from(shipsCache.values())
  });
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
