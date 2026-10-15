# furniture-vr-test-oaa

**Temporary test repo** — a one-room WebXR experience to walk around three furniture designs
(**O**NDA, **A**RCOS, **A**URA) in a Meta Quest 3. Will be deleted after testing.

**Open it:** in the Quest browser go to the GitHub Pages link of this repo and press **Enter VR**.
Works on a desktop browser too (drag to look, WASD to walk, click to interact).

## In the room
- One wall per piece, a reading corner, a halo pendant and two wall tablets.
- Steel-framed reeded glass with French doors onto a garden patio: the glass shows the real patio behind it, blurred, from each eye's position, so it has depth as you move.
- Furniture is at true 1:1 scale. If the room feels too big or small, use **Floor height** on the Atmosphere tablet.
- **Grip** (or pinch) to grab: doors swing on their hinges, drawers slide, LPs come out of the racks
  and can be carried, put back or dropped (real rigid-body physics); grip a cabinet body to slide or turn the whole piece.
- **Trigger** at a distance: point at a door/drawer to open or close it, point at an LP to pull it to your hand.
- **Records**: let go of one near a turntable and it loads itself (disc out of the sleeve, onto the platter, sleeve set aside, tonearm down);
  near a free slot (it glows) it slides back in; set down gently on a top it lies flat. Each console plays its own track.
- **Turntables**: press one to start / stop it (music is generated live, through that piece's speakers).
- **Tablets**: time of day, sun direction, interior lights, gallery spots, floor height, graphics quality (shadow detail and soft shadows from the gallery spots; resolution is never changed); records, volume, open/close all, reset.
- Left stick walks, right stick snap-turns; hand tracking works for grabbing and tapping the tablets.

Built with three.js (WebXR). The furniture models are the final CAD exports with real textures.
