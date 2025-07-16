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
