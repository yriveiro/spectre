# Diagram

A diagram is a canvas page that binds data to marks. The work is choosing the
mark the question needs, drawing it so nothing competes with the data, and
saying in one line what the reader should take from it.

This is not a style guide for charts in general. It is what to do when the
reader asks you to show them something in a canvas, and the answer is a drawing
rather than a page of prose.

## What this is not

| The reader wants | That skill |
| --- | --- |
| A machine, a system, or a mechanism drawn as a physical object | `anatomy`, which builds it from a geometry kit and audits it |
| A pull request, or a diff, shown as a page | `pr-canvas`, which owns PR identity and the evidence |
| An idea, a workflow, or a mock UI with no data behind it | `canvas`, which owns the artifact contract |
| Data bound to marks | this one |

## Choose the mark first

The question decides the mark. Write the question down in the reader's words
before you draw anything, then take the row.

| The reader is asking | The mark |
| --- | --- |
| How does one value move over another, in order? | a line |
| How do parts compare, and which is biggest? | a bar, sorted by value |
| Do two variables move together? | a scatter |
| What is the shape of this one distribution? | a histogram, not a bar chart of bins |
| How does a value spread across a population? | a box plot |
| How many of each thing, out of a whole? | a stacked bar for two or three parts, a sorted bar for more |
| Where does this happen, geographically? | a dot on a map |
| What are the stages, and what moves between them? | a diagram, not a chart |
| What changed, and when? | a change-over-time line, one axis |

If no row fits, the reader has a question about structure rather than about
data, and that is a diagram of stages rather than a plot.

## Get d3 on disk

A canvas page opens from the filesystem. It cannot `fetch` a library there,
because a fetch is always CORS-mode, and it cannot `import` one either. What it
can load is a **classic** relative script, so the vendored UMD build is what a
page uses:

```html
<script src="vendor/d3-7.9.0.min.js"></script>
```

No `type="module"`. No CDN `src`. The file name carries the version, so a page
built against one version keeps working after the pin moves to another.

Put the bundle in the canvas directory before you write the page:

```sh
bun run <the plugin directory>/scripts/sync-d3.ts <the canvas directory>
```

It prints the filename it wrote. The command checks the bytes against a pinned
digest before it extracts anything, is safe to run twice, and refuses rather
than overwrites a file that is not the pinned bundle.

## Draw it

1. **One takeaway, above the chart.** One sentence a reader reads first. If the
   chart needs a paragraph to explain, the mark is wrong, not the sentence.
2. **Start the value axis where the data starts.** A bar encodes length, so its
   axis starts at zero. A line encodes position, so it need not.
3. **One accent.** The one series that matters gets the accent colour. Every
   other series is a neutral, and they differ by lightness, never by hue alone.
   Never red against green as the only distinction.
4. **Label the ends, not every point.** A line is labelled at its first and last
   value and at a minimum or a crossing. A bar chart with eleven bars needs no
   labels at all, because the axis already carries them.
5. **No legend that repeats the axis.** A legend is for series the axis cannot
   name. If every entry is the axis label, delete it.
6. **Two measures, two panels.** Never two value axes on one plot, because the
   reader picks the crossing point they like. Stack two panels that share a
   horizontal axis instead.

## Cut, do not add

A chart fails by containing more than the question needs. Each of these is
almost always the right deletion.

- A 3D effect, a bevel, or a drop shadow on data.
- A smoothed curve through categories that have no order.
- A second colour used for decoration rather than to separate a series.
- A gridline that no value sits on.
- A data label that repeats a tick.
- An axis for a series that is flat at zero. Say it in the sentence instead.
- An animation that runs once and carries no comparison. Motion is for a change
  over time, and it must come to rest on its own.
- Mock data presented as real. A page with invented numbers says so on the page.

## Keep the layout coherent

The page is a document and the chart is part of it, so the chart obeys the same
grid as the text around it.

1. **One base unit.** Every margin, gap, and padding is a multiple of it. The
   chart's left edge is the text column's left edge.
2. **Three type sizes.** Title, axis label, tick. No fourth.
3. **Charts in a row share a baseline and a value scale**, or they are not in a
   row. Two panels with different scales beside each other compare nothing.
4. **One number alignment per page.** Pick right-aligned columns or a shared
   decimal point, and hold to it.
5. **The caption sits under the chart** and says what the reader is looking at,
   not what they should feel about it.

## The words obey the standard too

Titles, axis labels, legends, and the caption are prose. Run them before you
present:

```
tools.spectre.prose({ targets: ["<the canvas path>"] })
```

A finding is a sentence to read, not a defect to clear. The lexical half of the
standard stays off until `spectre.jsonc` names a dictionary, so this checks the
structural rules only: semicolons, passive voice, nominalizations, and long
sentences.

## Present it

Allocate with `tools.spectre.canvas({ action: "save", slug })`, write
`canvas.html` at the path it returns, and present it with
`tools.spectre.canvas({ action: "present", id })`. The vendor folder sits beside
the page, so copying the canvas directory copies the library with it.

## What this will not do

It does not invent data. A page with no real numbers says what it has no numbers
for, and draws the structure instead.

It does not load a library from the network. The bundle is on disk, beside the
page, or the page does not use it.

It does not draw a machine. That is `anatomy`.
