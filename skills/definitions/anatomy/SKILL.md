# Anatomy

Make the idea a real object. A figure of a gantry plotter, a dial gauge or a
cabinet of drawers is understood because the reader recognises the machine. A
stack of boxes with arrows on it is not understood at all.

**The object is the explanation.** Invent a well-made physical thing whose
working *is* the concept, then say in one sentence what moves and what that
motion means.

| Concept | Object |
|---|---|
| One GPU context serving many canvases | A gantry plotter: one print head visiting 16 wells |
| A cache key that skips work when nothing changed | A pin-tumbler lock: when every pin matches, the plug turns |
| Seven render targets with different bytes per texel | A chest of seven drawers, each as deep as its bytes |
| A separable blur, 49 × 49 taps against 49 + 49 | A bed-of-nails stamp beside two combs on rails |

Two ways this fails, and the fix is the same for both: too abstract, so nothing
reads as an object, and too flat, so there is no volume and nothing to find.
Both have one answer: a recognisable machine built from many small, precise,
purposeful parts.

## Start here

The geometry kit is in this repository, and a figure is a script that imports
it. Ask for the path rather than guessing it, because the plugin installs
under a hashed cache directory:

```
tools.spectre.anatomy({ action: "kit" })
```

That returns the absolute path of `kit/index.ts`. A build script imports it:

```ts
import { fitProjection, boxCorners, slabOf, solidSvg, figureSvg } from "<the path you were given>";
```

Write the figure as a script beside the project, run it with `bun`, and have it
write a standalone page. Keep the model pure: numbers and springs in one module,
no DOM, so the readout and the motion both come from the same source.

## Build it in this order

Decide the quality before writing any geometry, so spend the time here.

1. **Size it and say so.** A Figure is one mechanism, 40 to 80 parts, about 30 to
   90 minutes. A Hero is a dense object, 80 to 150 parts, two to four hours. An
   Epic is a whole vehicle or plant, six hours or more: give the estimate, offer
   a Hero that keeps the core idea, and build the Epic only if they choose it.
   Have a page that opens within the first hour, then deepen it.
2. **Truth first.** Collect the real numbers and behaviour of the thing being
   explained: counts, thresholds, curves. The readout, the motion and the caption
   must all be true of the same model.
3. **Invent the object.** A machine, tool, instrument or piece of furniture whose
   mechanism maps one to one onto the concept. Never copy a reference image. Take
   its finish, not its object.
4. **Write the parts list.** At least 40 parts, grouped: base, structure,
   mechanism, controls, and the subject itself, which is the one lit part. Each
   part sits on another part.
5. **Plan the world.** World units of about one pixel of the real thing, x and y
   on the floor, z up. A plan is a rounded rectangle `{ x, y, w, d, r }`. Choose
   the camera: azimuth 45 by default, 35 to 60 to show the long side, elevation
   30, or higher when the drawing needs to see inside something. Then `fitProjection`.
6. **Build the geometry once.** `slabOf` and `cylinder` for boxes and rounds,
   `disc` and `ringBand` for turned parts, `lathe` for anything curved along an
   axis, `tubePieces` for pipes and cables. Build a moving part at rest and move
   it with a transform. Only a part whose shape changes is rebuilt per frame.
7. **Paint back to front.** Sort by measured depth with `settle`, never by eye.
   Split anything that wraps another part into a back half and a front half.
8. **Frame it.** `plateHtml` puts `Fig n` at the top left, the title at the top
   right, the hint at the bottom left and the live readout at the bottom right.
   The legend and the caption go under the card. At most one tiny engraved label
   inside the drawing.
9. **Make it live.** Time-based motion only: an exponential follow, or a real
   spring where the subject is springy. Stop when settled and offscreen. Go still
   under reduced motion. Write attributes on refs and never re-render per frame.
10. **Prove it, then look at it.** Run the audit, fix every fault it names, and
    only then read the rendered page.

## The craft rules that matter

- **Solids, not wireframes.** Every part is filled and painted in order, so
  things in front hide things behind. No see-through edges.
- **Tone hierarchy.** Base and feet are `lo`, structure is `mid`, the subject is
  `hi`, and exactly one accent is `lit`: the part the reader should watch.
- **Every line ends on something.** A line that stops in the middle of a face is
  the most common fault, and `tools.spectre.anatomy({ action: "lines" })` finds
  them.
- **Nothing passes through anything.** Pipes keep about one and a half radii of
  air from anything they are not joined to, at rest and when the figure is
  exploded.
- **Every crossing is drawn in true depth order.** Measured by ray-casting, not
  tuned by eye.
- **Detail belongs to a part.** A screw on a plate, a groove in a rail, a scale
  with its ticks. Each one earns its place, and a bare face means unfinished work.

## Prove it

```
tools.spectre.anatomy({ action: "check", file: "figures/my-figure.ts" })
```

The build module has to export its recorder, because that is what the audit
measures:

```ts
export default { recorder: R, svg };
```

The audit reports clearance, the same in mid-flight, terminals, loose ends,
support and depth order. **A clean result is necessary and not sufficient.** It
cannot see a seam, a tone staircase or a texture that fades in the wrong place, so
read the rendered page too. And it reads the shapes you recorded, so record the
true shape of what you draw: a stand-in that covers less than most of the drawing
silences a real fault.

## Present it

Allocate a canvas with `tools.spectre.canvas({ action: "save", slug })`, write
the page to the path it returns, and present it with
`tools.spectre.canvas({ action: "present", id })`. Presentation goes through the
canvas tool and nothing else. A request to review a pull request visually is
`pr-canvas`; a page that is not an isometric figure is `canvas`.