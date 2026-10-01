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

## Jumping between dividers

Two palette commands:

- **Lua Divider Outline: Go to Next Divider Section**
- **Lua Divider Outline: Go to Previous Divider Section**

They jump to the nearest divider title and wrap around at the top/bottom. If there's nothing to jump to, you'll see *No divider sections found* down in the status bar.

There are no keybindings by default. If you want some, these two don't clash with much:

```json
[
  { "key": "alt+shift+[", "command": "luaDividerOutline.goToPreviousDivider", "when": "editorLangId == lua" },
  { "key": "alt+shift+]", "command": "luaDividerOutline.goToNextDivider", "when": "editorLangId == lua" }
]
```

## One-line subheaders

On by default. These show up nested under the section above them:

```lua
-- ------------------------------ My Subsection ------------------------------
```

A subsection covers everything down to the next subsection or section. A section covers everything down to the next section (or the end of the file).

## Right-click: select, copy, cut, delete

Right-click in a Lua file and you'll see:

- **Select Divider Section**
- **Copy Divider Section**
- **Cut Divider Section**
- **Delete Divider Section**

They grab the whole thing under your cursor, header plus the code below it, down to the next divider. If you're sitting inside a subsection, you get just that subsection. If you're on plain code between subsections, you get the full section.

Same commands are also on right-click in the **Lua Dividers** view (Explorer sidebar). VS Code does not let extensions add items to the built-in Outline row menu (see [microsoft/vscode#49925](https://github.com/microsoft/vscode/issues/49925)), so this extension ships its own Dividers tree where Select / Copy / Cut / Delete work from the clicked row, including multi-select. Click a row to jump to its title.

## Settings

```json
{
  "luaDividerOutline.separatorLength": 70,
  "luaDividerOutline.allowCommentedSeparators": true,
  "luaDividerOutline.showHintText": false,
  "luaDividerOutline.showLineNumbers": true,
  "luaDividerOutline.subheaders.enabled": true,
  "luaDividerOutline.subheaders.minimumDashLength": 3,
  "luaDividerOutline.subheaders.maximumDashLength": 200,
  "luaDividerOutline.insert.defaultTitle": "Section",
  "luaDividerOutline.decorations.enabled": true,
  "luaDividerOutline.decorations.titleBold": true,
  "luaDividerOutline.decorations.titleColor": "#ffffff",
  "luaDividerOutline.decorations.separatorDim": true,
  "luaDividerOutline.decorations.separatorOpacity": 0.65
}
```

By default you see line numbers in the Outline, like this:

```
Alpha  1-6
  Sub  5-6
Beta   7-9
```

That's `showLineNumbers`. Turn it off and you just get clean titles. Turn `showHintText` on if you want the little `divider section` / `divider subsection` labels back. Line numbers win when both are on. Both are resource-scoped, so a workspace can override them in `.vscode/settings.json`:

```json
{
  "luaDividerOutline.showHintText": true
}
```

```json
{
  "luaDividerOutline.showLineNumbers": false
}
```

The insert title is also per-workspace / per-folder. Empty means `Section`:

```json
{
  "luaDividerOutline.insert.defaultTitle": "Overview"
}
```

## Title styling in the editor

Divider titles get painted right in the file. Bold white by default:

```json
{
  "luaDividerOutline.decorations.enabled": true,
  "luaDividerOutline.decorations.titleBold": true,
  "luaDividerOutline.decorations.titleColor": "#ffffff"
}
```

Both main titles and subheaders use it. Clear it to `""` to keep your theme's comment color. Turn `decorations.enabled` off if you want the file left completely alone.

The `------` lines above and below each title are faded a bit so the title pops. Turn that off with:

```json
{
  "luaDividerOutline.decorations.separatorDim": false
}
```

Or dial how faded they are, from `0.1` (barely there) to `1` (normal text):

```json
{
  "luaDividerOutline.decorations.separatorOpacity": 0.65
}
```

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
