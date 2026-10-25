# House footage for ZoneZero

Researched October 25, 2026.

## New sample: suburban home and trees

- **Jaxon Matthew Willis — suburban home and trees (Pexels, clip 17171031)**
  - Source: https://www.pexels.com/video/drone-outdoor-home-17171031/
  - Download: https://videos.pexels.com/video-files/17171031/17171031-hd_1920_1080_30fps.mp4
  - Creator: Jaxon Matthew Willis.
  - License: https://www.pexels.com/license/ (free use and modification; do not imply endorsement).
  - Original local file: `stock/pexels-jaxon-matthew-willis-17171031-original.mp4`.
  - App-ready local file: `suburban-home-and-trees.mp4` (1280 × 720, 15 fps, H.264, audio removed, fast-start MP4).
  - Actual downloaded media: 23.39 seconds, 1280 × 720; approximately 8.4 MB before conversion.
  - Visually checked at multiple points: one continuous drone approach/reveal of a two-story suburban home, with pitched roof, driveway, front planting, tall trees, and neighboring houses. This differs from the original patio-focused clip.
  - Coverage: partial front/oblique exterior. Trees obscure parts of the home at first; the rear, deck underside, vent screening, and detailed gutter condition are not established by this footage.
  - In the app: **New assessment → Sample clip → New: suburban home & trees · 23s → Try sample footage**. The existing `sample=video` route selects this file as the only top-level MP4 in `samples/`; the original patio clip remains selectable through `sample=stock`.
  - Downloaded October 25, 2026. No assessment was started while adding this sample.

To prepare this sample on another machine (run from the repository root in PowerShell):

```powershell
Invoke-WebRequest -Uri 'https://videos.pexels.com/video-files/17171031/17171031-hd_1920_1080_30fps.mp4' -OutFile 'samples/stock/pexels-jaxon-matthew-willis-17171031-original.mp4'
ffmpeg -i samples/stock/pexels-jaxon-matthew-willis-17171031-original.mp4 -vf "scale=-2:720,fps=15" -c:v libx264 -crf 25 -preset veryfast -an -movflags +faststart samples/suburban-home-and-trees.mp4
```

The app-ready `suburban-home-and-trees.mp4` is included in the repository so the new sample works on other checkouts. Original downloads in `stock/` remain local and ignored by Git.

## Original downloaded video for a pipeline smoke test

- **Kindel Media — modern house and outdoor patio (Pexels, clip 7578541)**
  - Source: https://www.pexels.com/video/an-exterior-design-of-a-modern-house-7578541/
  - Download: https://videos.pexels.com/video-files/7578541/7578541-uhd_3840_2160_30fps.mp4
  - Creator: Kindel Media.
  - License: https://www.pexels.com/license/ (free use and modification; do not imply endorsement).
  - Original local file: `stock/pexels-kindel-media-7578541-original.mp4`.
  - Upload-ready local file: `stock/pexels-kindel-media-7578541.mp4` (480p, 15 fps, audio removed).
  - Actual downloaded media: about 20 seconds, 2560 x 1440 before conversion.
  - Suitable for testing video decoding, inventory, generation, and the render pipeline. This is a partial exterior view, not a full walk around all four sides; missing sides and materials must remain uncertain. Do not treat a successful run as validation of reconstruction accuracy.

## More relevant home-assessment references

1. **FireSmart BC — Home Assessment Overview**
   - https://firesmartbc.ca/resource/firesmart-bc-home-assessment-overview/
   - Embedded video: https://player.vimeo.com/video/834484593
   - The publisher describes a typical home assessment with practical advice for the house and property. This is a strong candidate for inspection-style footage.
   - Link only; download and reuse permission has not been established.

2. **Placer County / CAL FIRE — Home Hardening & Defensible Space WUI Demo Site Walk-Through**
   - https://vimeo.com/1187477902
   - On-site tour with CAL FIRE Unit Forester Steve Garcia, covering roof/eaves, vents, siding, decking, and defensible-space zones.
   - Useful coverage of the features in the Scene Kit. A demonstration site is not necessarily one complete residential property; verify scene continuity before feeding a segment to the survey.
   - Link only; download and reuse permission has not been established.

3. **IBHS — Wildfire Prepared Home video series**
   - https://wildfireprepared.org/video-series/
   - Feature-level clips about Zone 0, roofs, gutters, vents, siding clearance, and decks. Useful reference material; avoid joining different homes into one input video.
   - Link only; download and reuse permission has not been established.

## Additional downloadable house exteriors

- Curtis Adams, suburban house: https://www.pexels.com/video/modern-architectural-design-of-a-house-4301618/
- Curtis Adams, yellow-house exterior (6 seconds): https://www.pexels.com/video/exterior-design-of-a-house-4307517/
- qimono, house/exterior/estate: https://pixabay.com/videos/house-exterior-estate-real-15356/ (Pixabay Content License, https://pixabay.com/service/license-summary/).

These are candidates based on their source descriptions, not verified four-sided walk-around captures. For a convincing fidelity test, use a continuous 1–2 minute ground-level circuit of one home that shows the roof edges, gutters, vents, fence connections, deck underside, and nearby plants/mulch/firewood.
