# Marine Web Map

A simple webpage displaying ships on a world map using Mapbox GL JS. Data is fetched from the `/ships/within_radius/` API.

## Setup

1. Obtain a Mapbox access token from [mapbox.com](https://mapbox.com/).
2. Replace `YOUR_MAPBOX_ACCESS_TOKEN` in `script.js` with your token.
3. Serve the files using any static server to avoid CORS issues, e.g.:

```bash
npx serve .
```

Then open the displayed local URL in your browser.

As you pan and zoom, ships within the current map view are requested from the API. Click an individual ship marker to see its details in a popup. Markers are clustered for performance.

Results from each request are cached in the browser so ships remain visible as you move around. Cached ships are kept forever and persisted in IndexedDB so reloading the page does not clear them. If fewer than 200 ships are shown and you stay in one spot for a moment, additional pages of the API are automatically loaded to fill in more ships.
On the first visit, all ships are requested by calling the API without any location parameters and walking through every page so the cache starts fully populated.

### Query parameters

You can add `?fetch_all` to the page URL to force a full download of every ship even if data is already cached. Use `no_clustering` to disable marker clustering so every ship is displayed individually.
