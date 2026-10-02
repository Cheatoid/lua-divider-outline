# Lua Divider Outline

[![GitHub Repository](https://img.shields.io/github/stars/Cheatoid/lua-divider-outline?style=flat&logo=github&label=GitHub)](https://github.com/Cheatoid/lua-divider-outline)
[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/Cheatoid.lua-divider-outline)](https://marketplace.visualstudio.com/items?itemName=Cheatoid.lua-divider-outline)
[![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/Cheatoid.lua-divider-outline)](https://marketplace.visualstudio.com/items?itemName=Cheatoid.lua-divider-outline)
[![Visual Studio Marketplace Rating](https://img.shields.io/visual-studio-marketplace/r/Cheatoid.lua-divider-outline)](https://marketplace.visualstudio.com/items?itemName=Cheatoid.lua-divider-outline#review-details)

![Preview](.resources/preview.png)

If your Lua files get long, this helps. It picks up your `--` divider comments and shows them in the Outline (in the Explorer tab), so you can jump around a big file without scrolling forever.

It plays nice with the **Lua / LuaLS (sumneko)** extension. Your dividers show up next to the real Lua symbols, nothing gets replaced.

## Main header

This is what it looks for by default:

```lua
----------------------------------------------------------------------
-- My Section
----------------------------------------------------------------------
```

Both separator lines need exactly 70 `-` characters unless you change the setting. The middle line has to be a `--` comment with your title on it.

Lines with `--` in front of the dashes work too:

```lua
-- ----------------------------------------------------------------------
-- My Section
-- ----------------------------------------------------------------------
```

Only Lua files get scanned.

## Inserting a divider

Run **Lua Divider Outline: Insert Divider Section** (or right-click in a Lua file and pick it) and it drops a full header at your cursor:

```lua
local x = 1
----------------------------------------------------------------------
-- Section
----------------------------------------------------------------------
```

It uses your `separatorLength`, so the new divider shows up in the Outline right away. It keeps the indentation of the line you're on, and you can split a line in the middle if you want. Multiple cursors work, everything lands in one undo step.

The word `Section` (or whatever you set) comes out selected, so just type over it.

**Insert Divider Subsection** drops a one-line subheader instead:

```lua
-- Subsection --------------------------------------------------------
```

It pads the trailing `-` characters so the line totals your `separatorLength` (70 by default, excluding leading whitespace), clamped into your minimum/maximum dash range so the new line is picked up right away. Same deal: indentation kept, multiple cursors work, one undo step, title left selected.

## Jumping between dividers

Three palette commands:

- **Lua Divider Outline: Go to Next Divider Section**
- **Lua Divider Outline: Go to Previous Divider Section**
- **Lua Divider Outline: Go to Divider Section** (fuzzy QuickPick over every section and subsection, with live preview as you highlight rows)

Next/Previous jump to the nearest divider title and wrap around at the top/bottom, including subsections. Set `luaDividerOutline.navigation.includeSubheaders: false` to jump between main sections only. If there's nothing to jump to, you'll see *No divider sections found* down in the status bar.

There are no keybindings by default. If you want some, these two don't clash with much:

```json
[
  { "key": "alt+shift+[", "command": "luaDividerOutline.goToPreviousDivider", "when": "editorLangId == lua" },
  { "key": "alt+shift+]", "command": "luaDividerOutline.goToNextDivider", "when": "editorLangId == lua" }
]
```

## Folding dividers

Every section and subsection is a folding range, so **Fold All** (`Ctrl+K Ctrl+0`) collapses the file to its table of contents, and the **Lua Divider Outline: Collapse All** command folds the current Lua file. The **Expand All** button in the **Lua Dividers** view expands the tree back out.

## One-line subheaders

On by default. These show up nested under the section above them:

```lua
-- My Subsection -----------------------------------------------------
```

A trailing run of at least 2 `-` characters (up to 200) is required — controlled by `luaDividerOutline.subheaders.minimumDashLength` / `maximumDashLength`. A leading run is optional, so the legacy symmetric style also matches:

```lua
-- --- My Subsection ---
```

A subsection covers everything down to the next subsection or section. A section covers everything down to the next section (or the end of the file).

## Right-click: select, copy, cut, delete, rename, duplicate

With `luaDividerOutline.editorContextMenu.enabled: true`, right-click in a Lua file and you'll see:

- **Select Divider Section**
- **Copy Divider Section**
- **Cut Divider Section**
- **Delete Divider Section**
- **Rename Divider Section**
- **Duplicate Divider Section**

They grab the whole thing under your cursor, header plus the code below it, down to the next divider. If you're sitting inside a subsection, you get just that subsection. If you're on plain code between subsections, you get the full section.

**Rename** prompts for a new title and rewrites just the title line, keeping the dashes and indentation intact. **Duplicate** copies the section right below itself and jumps to the copy. **Move Divider Section Up / Down** (Command Palette only) swaps a section with its neighbor, or a subsection within its own section — or just drag rows in the **Lua Dividers** view (see below).

Turn the editor entries on with `luaDividerOutline.editorContextMenu.enabled: true` if you want them in the right-click menu. The commands stay available from the Command Palette.

Same commands are also on right-click in the **Lua Dividers** view (Explorer sidebar). VS Code does not let extensions add items to the built-in Outline row menu (see [microsoft/vscode#49925](https://github.com/microsoft/vscode/issues/49925)), so this extension ships its own Dividers tree where Select / Copy / Cut / Delete work from the clicked row, including multi-select. Click a row to jump to its title.

## Drag to reorder in the Lua Dividers view

Left-click-and-drag a row to move it. Dropping onto another row inserts before it; dropping on empty tree space moves to the end. Sections reorder among sections, subsections reorder within their own section. Multi-select drags keep their relative order. Everything lands in one undo step, and the cursor follows the first moved title.

## Settings

Here's everything you can tweak, with what each one does:

```jsonc
{
  // How long your big divider lines are. 70 looks nice.
  "luaDividerOutline.separatorLength": 70,

  // Also accept separators with "--" in front of the dashes.
  "luaDividerOutline.allowCommentedSeparators": true,

  // Show little "divider section / subsection" labels in the Outline. Off keeps things clean.
  "luaDividerOutline.showHintText": false, // per workspace

  // Show line ranges like "12-48" in the Outline. Wins over the hint text above.
  "luaDividerOutline.showLineNumbers": true, // per workspace

  // Pick up one-line "-- Title ---..." comments as nested Outline entries.
  "luaDividerOutline.subheaders.enabled": true,

  // Shortest trailing dash run a subheader needs to count (leading dashes optional).
  "luaDividerOutline.subheaders.minimumDashLength": 2,

  // Longest dash run a subheader can have before we ignore it.
  "luaDividerOutline.subheaders.maximumDashLength": 200,

  // Include subsections when jumping to next / previous divider. Off = main sections only.
  "luaDividerOutline.navigation.includeSubheaders": true, // per workspace

  // The title pre-filled when you insert a section. Empty falls back to "Section".
  "luaDividerOutline.insert.defaultTitle": "Section", // per workspace

  // Show divider commands in the editor right-click menu. Off by default.
  "luaDividerOutline.editorContextMenu.enabled": false, // per workspace

  // Paint divider titles in the editor. Off leaves your file alone.
  "luaDividerOutline.decorations.enabled": true, // per workspace

  // Make divider titles bold.
  "luaDividerOutline.decorations.titleBold": true, // per workspace

  // Title color, e.g. "#d7a1ff". Empty keeps your theme's comment color.
  "luaDividerOutline.decorations.titleColor": "#ffffff", // per workspace

  // Make subheader (subsection) titles bold.
  "luaDividerOutline.decorations.subheaderTitleBold": true, // per workspace

  // Subheader title color, e.g. "#d7a1ff". Empty keeps your theme's comment color.
  "luaDividerOutline.decorations.subheaderTitleColor": "#ffffff", // per workspace

  // Fade the "------" lines a bit so titles pop.
  "luaDividerOutline.decorations.separatorDim": true, // per workspace

  // How faded: 0.1 is barely there, 1 is normal text.
  "luaDividerOutline.decorations.separatorOpacity": 0.5 // per workspace
}
```

Small notes: with line numbers on you'll see things like `Alpha  1-6`. And the insert title comes out selected, so just type over it.

## Development

Install dependencies:

```bash
npm install
```

Check the JS:

```bash
npm run check
```

Build a VSIX:

```bash
npm run package
```

Build and install it into your VS Code:

```bash
npm run install:vsix
```

Build, remove the old install, install the new one:

```bash
npm run reinstall:vsix
```

Or package without needing git metadata:

```bash
npm run package:force
```

For hacking on it, open the folder and hit `F5` to get an Extension Development Host. `Ctrl+Shift+B` runs the packaging task.
