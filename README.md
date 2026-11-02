# Mercury Visualiser

Mercury Visualiser is a plugin for [Obsidian](https://obsidian.md) that makes the Graph view easier to read. It works in the main Graph view and in local graphs, on computers and on phones.

It adds five things, and you can switch each one on or off at any time:

1. **Tag colours.** Every tag gets its own colour automatically. When you use a new tag, it gets the colour that looks most different from the ones you already have. The colours come from a picture of the planet Mercury.
2. **Spread-out links.** A note's links fan out evenly all the way around it, like the slices of a pie, instead of all pointing one way.
3. **Pie-chart dots.** A note with several tags shows all of their colours: as a thin coloured ring around its dot, or as a little pie chart.
4. **Line labels.** Each line between two notes shows where the link was written, for example the name of the video both people were in, tinted with the colours of the two notes.
5. **Smoother big graphs.** Parts of the graph you can't see aren't drawn, less important dots and lines drop away as you zoom out, and far out the dots blend into a soft coloured map.

It was made for the Project Mercury vault, but it works with any vault.

## Installing

### Option 1: with the BRAT plugin

BRAT installs plugins straight from GitHub and keeps them up to date.

1. Install and turn on **BRAT** from Obsidian's community plugins.
2. Open the command palette and run BRAT's **Add a beta plugin for testing** command.
3. Enter `Flux-Sniffer-Mods/Mercury-Visualiser` and confirm.
4. Go to **Settings > Community plugins** and turn on **Mercury Visualiser**.

This needs a published release on GitHub. If BRAT says it can't find one, use option 2.

### Option 2: by hand

1. Get the three plugin files: `main.js`, `manifest.json` and `styles.css`. They are attached to each release on GitHub, or come in the plugin zip file.
2. Find your vault's folder and open the hidden `.obsidian` folder inside it, then the `plugins` folder. Create `plugins` if it isn't there.
3. Make a folder called `mercury-visualiser` and put the three files in it.
4. Restart Obsidian, go to **Settings > Community plugins**, and turn on **Mercury Visualiser**. If you don't see it, tap the refresh button next to "Installed plugins".

On a phone, use a file manager app that can show hidden folders. Folders starting with a dot are hidden.

### Updating

With BRAT, updates arrive on their own. By hand, replace the three files with the new ones and restart Obsidian.

## Getting started

Open the Graph view after turning the plugin on. You will notice:

- **A small row of buttons** in the top-left corner of every graph. These switch the features on and off.
- **More colours.** Every tag that didn't have a colour now has one. Colours you had already set up in the Graph view's "Groups" section are kept exactly as they were.
- **Links fanning out.** The graph rearranges itself so each note's links spread around it. In a big vault the first arrangement can take a few seconds (longer on a phone), and a small progress bar shows next to the buttons. After that it is remembered, so reopening the graph is instant.

## Switching features on and off

There are three ways to do this, and they always stay in step with each other.

**The buttons on the graph**, from left to right:

| Button | What it switches |
| --- | --- |
| Palette | Tag colours |
| Sun | Spread-out links |
| Pie chart | Pie-chart dots |
| Tag | Line labels |
| Layers | Smoother big graphs |
| Circular arrows | Rearranges this graph again (only shown while spread-out links are on) |

A lit-up button means that feature is on.

**The command palette.** Search for "Mercury Visualiser" to find a "Toggle" command for each feature, plus:

- Rearrange the graph again
- Re-spread tag colours
- Colour new tags now
- Edit the colours new tags can get
- Show graph diagnostics

You can give any of these a keyboard shortcut in **Settings > Hotkeys**.

**The settings page.** Go to **Settings > Mercury Visualiser** for the switches and every option described below.

## Tag colours

Each tag gets a colour, and the Graph view uses it for notes with that tag.

- **New tags are coloured straight away.** The plugin picks the colour that is most different from the colours already in use, so tags stay easy to tell apart.
- **Your own colours are safe.** Colours you set up yourself in the Graph view's "Groups" section are kept and locked. The plugin never deletes your groups.
- **Changes go both ways.** If you change a colour in the Graph view's "Groups" section, the plugin picks it up. If you change it in the plugin's settings, the Graph view updates.
- **Turning it off** removes only the colour groups the plugin added. Turn it on again and the same colours come back.

### Settings

| Setting | What it does |
| --- | --- |
| Colour by | "Top-level tag" gives `#Music/Singer` and `#Music/Rapper` the same colour as `#Music`. "Full nested tag" gives each one its own colour. |
| Minimum notes per tag | Tags used on fewer notes than this don't get a colour. |
| Tags to skip | Tags that should never get a colour, separated by commas. |
| Colours to choose from | Opens the colour picker described below. |
| Update the Graph view's colour groups | Turn off if you only want the colours for the pie-chart dots. |
| Tidy up unused groups | Removes a colour the plugin added once nobody uses that tag any more. |
| Re-spread colours | Gives every tag that you haven't locked a fresh colour, as spread out as possible. |
| Recolour every tag | The same, but also replaces colours you chose yourself. |
| Tag colours | Every tag with its colour. Tap a colour to change it, the lock to keep it, or the shuffle button for a different one. |

### Choosing which colours can be used

Open **Colours to choose from > Edit...** in the settings. A preview shows the next colours new tags would get, and some example pie-chart dots.

You can pick colours from:

- **Mercury** (the default). 59 colours taken from an enhanced-colour photo of the planet Mercury: violets, bright blues, teals, lime-yellows and hot reds. To adjust them, press "Copy to my own colours".
- **The whole spectrum.** Any colour, within the brightness, vividness and range of hues you choose with the sliders.
- **My own colours.** Add colours one by one, paste a list of colour codes (like `#e63946`), or copy the colours your tags have now.

If every colour on your list is in use, new tags get colours from the spectrum sliders instead.

Press **Save** to use the new colours for future tags. Press **Save and recolour tags** to update existing tags now as well. Colours you chose yourself are kept unless you press **Save and recolour every tag**.

If you used version 1.0, the colours the plugin had picked automatically are swapped for Mercury colours once, when you update. Colours you chose yourself are kept.

## Spread-out links

Normally, a note's links can bunch up on one side like a broom. With this on, they spread out evenly all the way round, like the spokes of a wheel.

- **Hovering, clicking, searching and filters** in the Graph view all work as normal.
- **Dragging a note** moves it, and it stays where you drop it.
- **Editing notes doesn't shuffle the graph.** When you add a note or a link, only that note and its neighbours move.
- **Turning it off** gives the graph back to Obsidian's normal movement.

### Settings

| Setting | What it does |
| --- | --- |
| Style | "Spokes": every note's links spread around it. "Rings": one note sits in the middle (the open note in a local graph, or the most-linked note in the main graph), each step away is on its own ring, and each branch gets its own slice of the circle. |
| Use in the main graph / local graphs | Choose where it applies. |
| Match the graph's link distance | Use the line length from the Graph view's own "Forces" settings. |
| Spoke length | How long the lines are, when not matching the graph. |
| Splay strength | How firmly the links are pushed into an even spread. |
| Spacing | How much space there is between unrelated notes. |
| Animate | Shows notes gliding into place. Turn this off on slow devices. |
| Rearrange the graph again | Arranges the graph again from the start. |

## Pie-chart dots

Normally a dot can only show one tag colour. With this on, a note with several tag colours shows all of them. Colours always come in the same order, so a colour sits in the same place on every dot.

There are two styles:

- **Ring around the dot** (the default). The dot stays as it is, with a thin ring of coloured arcs around it, one for each colour. This keeps busy notes calm.
- **Filled pie.** The whole dot becomes a pie chart, with a slice for each colour. The note you have open keeps its highlight ring around its pie.

By default the colours only appear once you zoom in, at the same point as note names. Zoomed out, dots stay their normal single colour, so the graph doesn't get noisy. Pointing at a note shows the colours of that note and its neighbours, even when zoomed out.

If tag colours are switched off, the dots use your Graph view colour groups instead.

### Settings

| Setting | What it does |
| --- | --- |
| Style | "Ring around the dot" or "Filled pie". |
| Only show when zoomed in | Colours fade in with note names as you zoom in. Turn off to always show them. |
| Show on | Only notes with two or more tag colours, or every note with a tag colour. |
| Size slices by tag count | Off: every colour gets an equal share. On: a colour that covers more of the note's tags gets a bigger share. |
| Lines between slices | Thin lines between the slices (filled style only; rings always have small gaps). |
| Colour tag nodes | When the Graph view shows tags as their own dots, gives each one its tag's colour. |

## Line labels

The plugin reads how links are written in your notes. A line like this:

```
Turbopunch: [[Someone]], [[Someone Else]]
```

labels both lines "Turbopunch". A list like this:

```
asdf:
- asdfmovie2: [[Someone]]
- asdfmovie4: [[Someone Else]]
```

labels the lines "asdfmovie2" and "asdfmovie4". The label is whatever comes before the colon (or before a dash). Headings above a list count too.

Some titles mean little on their own, like season and episode numbers (`S3`, `E2`, `Season 1`) or roles that appear in lots of notes (`Cast`, `Guests`, `Host`). These get the name of the listing they sit under, so a line from

```
Taskmaster UK:
- S3: [[Someone]]
```

is labelled "Taskmaster UK › S3".

To keep the graph tidy:

- **Labels fade out as you zoom out**, at the same point as note names. This uses the Graph view's own "Text fade threshold" setting (under "Display").
- **Hovering a note** shows the labels of all its lines, even when zoomed out.
- **Labels never sit on top of each other** or on top of note names.
- **When several lines from one note share a label**, it is shown once.
- **Only lines on screen** get labels, starting from the middle.
- **Labels are coloured** with a blend of the tag colours of the two notes their line joins. A label between notes without tag colours stays plain.

### Settings

| Setting | What it does |
| --- | --- |
| Label with | "Its own line" (for example `asdfmovie4`, or `Taskmaster UK › S3` as above), "The listing" (`asdf`), or "Both" (`asdf › asdfmovie4`). |
| Colour the labels | Tint labels with their notes' colours, or keep them plain. |
| Most labels at once | The most labels shown together. Fewer is tidier and faster. |

## Smoother big graphs

This works like "level of detail" in video games: the graph draws less when you can't see it.

- **Zoomed in:** notes and lines outside the screen aren't drawn.
- **Zooming out:** the least important shapes drop away bit by bit, like a map that hides small towns before cities. Lines go first, starting with lines to notes that have only one link, then the smallest dots. Busy notes and their main links stay. Pointing at a note always shows it, its neighbours and their lines in full.
- **Zoomed far out:** the tiny dots and lines fade into a soft map. Each area is coloured by the tags of the notes in it, and is lighter where notes are packed tightly. Zoom back in and the dots return.

In testing with the Project Mercury vault (7,549 dots), the graph drew about 2.5 times faster when zoomed in, about 1.3 to 1.7 times faster part-way out, and about 8 times faster when zoomed right out.

### Settings

| Setting | What it does |
| --- | --- |
| Skip what's off screen | Don't draw notes and lines outside the view. |
| Fewer shapes when zoomed out | Drop the least important lines and dots as you zoom out. |
| How much to drop | How many of the dots are gone by the time the density map takes over (lines go a little sooner). |
| Density map when zoomed out | Show the soft map instead of tiny dots when far out. |
| Switch to the map below | How small the dots get (in pixels) before the map takes over completely. It starts fading in at about twice this size. |
| Map softness | How blurred the map is, from 0 (crisp) to 3 (very soft). |
| Map colours | Use tag colours, or a single colour. Either way, busier areas are lighter. |

## Good to know

- **The Graph view has no official plugin support**, so this plugin works with its insides carefully. If a future Obsidian update changes them, the affected feature turns itself off instead of breaking your graph.
- **Turning the plugin off doesn't remove the colours it added**, because Obsidian also turns plugins off whenever it closes. To remove them, switch off tag colours first, then turn off the plugin.
- **Something looks wrong?** Switch that feature off from its button, and the graph goes back to normal.
- **Colours on dots the wrong size or in the wrong place?** Open the Graph view, then go to **Settings > Mercury Visualiser > Troubleshooting > Graph diagnostics** (or run "Show graph diagnostics" from the command palette). It shows how your Obsidian draws its dots. Press **Copy** and send it to whoever is helping you.

## Removing the plugin

1. In the plugin's settings, switch off **Colour tags automatically**. This removes the colour groups it added.
2. Go to **Settings > Community plugins** and uninstall **Mercury Visualiser**.

## For developers

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install
npm run dev     # rebuild main.js whenever a file changes
npm test        # run the tests
npm run build   # check types and make a release build
```

To try your changes, copy or link this folder into a test vault at `.obsidian/plugins/mercury-visualiser/`.

### Where things are

| Folder | What's in it |
| --- | --- |
| `src/main.ts` | Starts the plugin: settings, commands, events. |
| `src/tags/` | Finds tags, picks their colours, and keeps the Graph view's colour groups in step. |
| `src/colour/` | Colour maths, the colour picker and the Mercury palette. |
| `src/labels/` | Finds the listing each link was written under. |
| `src/layout/` | The spread-out layout, which runs in the background. |
| `src/graph/` | Everything drawn onto the Graph view: pies, labels, the density map and the buttons. |
| `tests/` | Automated tests. |

### Publishing a release

1. Make sure the version number in `manifest.json` and `package.json` has gone up, and that the new version is listed in `versions.json`. On a computer, `npm version minor` (or `patch`) does all three.
2. Get the change onto `main` (for example by merging a pull request).
3. On GitHub, open the **Actions** tab, choose **Release**, press **Run workflow**, and pick `main`. This works from a phone too.

GitHub then builds the plugin and publishes a release with the three files, named after the version. BRAT and manual installs use that release. Pushing a tag that matches the version (such as `1.2.0`) does the same.

## Licence

MIT. See [LICENSE](LICENSE).
