---
name: map-animation
description: Make viral map animation videos (1080p MP4) from one prompt — states, countries or regions lighting up over time with a year counter, labels and era colors. Use when the user asks for a map animation, "how X grew", border changes over time, or a history map video.
---

# Map animation

1. Ask what the map should show: region, list of events (name + year), title, colors per era.
2. Copy `template.html`. Replace the `ADM` list with the user's events, the title, the legend and the `color()` eras.
   - US states use `lib/states-10m.json` (U.S. Census Bureau data via us-atlas, public domain).
   - For other regions, download a free TopoJSON/GeoJSON file and change the projection (`d3.geoAlbersUsa` → `d3.geoMercator` or `d3.geoNaturalEarth1`).
3. Serve the folder (`python3 -m http.server 8000`) and preview `http://localhost:8000/template.html`.
   Call `seek(t)` in the console to check any moment.
4. Render: `python3 render.py http://localhost:8000/template.html out.mp4 --fps 30`
   Needs Google Chrome and FFmpeg. Output: 1920×1080 MP4, ready for YouTube.
5. Before rendering, check stills: `python3 render.py <url> check.png --frames 3,20,40`.
