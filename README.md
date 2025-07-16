# Marine Web Map

A simple webpage displaying ships on a world map using Mapbox GL JS. Ship
positions are loaded from a CSV dump available at
`https://staging.ship.lascade.com/static/ships_data_dump.csv`.

## Setup

1. Obtain a Mapbox access token from [mapbox.com](https://mapbox.com/).
2. Replace `YOUR_MAPBOX_ACCESS_TOKEN` in `script.js` with your token.
3. Serve the files using any static server to avoid CORS issues, e.g.:

```bash
npx serve .
```

Then open the displayed local URL in your browser.

All ships are loaded from the CSV file on the first visit and displayed using Mapbox clustering for performance. Click an individual ship marker to see its details in a popup.
A floating action button lets you enable or disable clustering.

Ship data is cached in IndexedDB so reloading the page does not require another download. The `fetch_all` query parameter forces the CSV to be downloaded again.

### Query parameters

You can add `?fetch_all` to the page URL to force a full download of every ship even if data is already cached.
Use `no_clustering` to disable marker clustering so every ship is displayed individually.
When clustering is disabled, the map shows at most 1000 ships in the current viewport for smooth performance.
Use the circular button in the bottom right corner to toggle clustering. Clicking it simply reloads the page with or without the `no_clustering` parameter.

Ships without valid coordinates are skipped when loading the CSV to avoid errors.
