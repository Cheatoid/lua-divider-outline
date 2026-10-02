const vscode = require('vscode');

const MAIN_KIND = vscode.SymbolKind.Namespace;
const SUBHEADER_KIND = vscode.SymbolKind.Namespace;

const INSERT_DIVIDER_COMMAND = 'luaDividerOutline.insertDividerSection';
const INSERT_DIVIDER_SUBSECTION_COMMAND = 'luaDividerOutline.insertDividerSubsection';
const RENAME_DIVIDER_COMMAND = 'luaDividerOutline.renameDividerSection';
const DUPLICATE_DIVIDER_COMMAND = 'luaDividerOutline.duplicateDividerSection';
const MOVE_DIVIDER_UP_COMMAND = 'luaDividerOutline.moveDividerSectionUp';
const MOVE_DIVIDER_DOWN_COMMAND = 'luaDividerOutline.moveDividerSectionDown';
const GO_TO_NEXT_DIVIDER_COMMAND = 'luaDividerOutline.goToNextDivider';
const GO_TO_PREVIOUS_DIVIDER_COMMAND = 'luaDividerOutline.goToPreviousDivider';
const COPY_DIVIDER_COMMAND = 'luaDividerOutline.copyDividerSection';
const CUT_DIVIDER_COMMAND = 'luaDividerOutline.cutDividerSection';
const DELETE_DIVIDER_COMMAND = 'luaDividerOutline.deleteDividerSection';
const SELECT_DIVIDER_COMMAND = 'luaDividerOutline.selectDividerSection';
const REVEAL_DIVIDER_COMMAND = 'luaDividerOutline.revealDivider';
const REFRESH_DIVIDERS_COMMAND = 'luaDividerOutline.refreshDividers';
const EXPAND_ALL_DIVIDERS_COMMAND = 'luaDividerOutline.expandAllDividers';
const COLLAPSE_ALL_DIVIDERS_COMMAND = 'luaDividerOutline.collapseAllDividers';
const DIVIDER_VIEW_ID = 'luaDividerOutlineView';
const DIVIDER_DRAG_MIME = 'application/vnd.code.tree.luadivideroutlineview';
const DEFAULT_SECTION_TITLE = 'Section';
const DEFAULT_SUBSECTION_TITLE = 'Subsection';
const DOUBLE_CLICK_MS = 500;
let lastRevealKey = null;
let lastRevealTime = 0;

// Lua long-bracket helpers: `[` + n * `=` + `[` opens, `]` + n * `=` + `]`
// closes (n >= 0, e.g. `[[ ]]`, `[=[ ]=]`). Used to ignore divider-like
// lines that live inside long string literals.
function getLongBracketOpener(text, pos) {
  if (text[pos] !== '[') {
    return -1;
  }
  let i = pos + 1;
  let eq = 0;
  while (i < text.length && text[i] === '=') {
    eq++;
    i++;
  }
  if (i < text.length && text[i] === '[') {
    return eq;
  }
  return -1;
}

function isLongBracketCloser(text, pos, eq) {
  if (text[pos] !== ']') {
    return false;
  }
  for (let k = 0; k < eq; k++) {
    if (text[pos + 1 + k] !== '=') {
      return false;
    }
  }
  return text[pos + 1 + eq] === ']';
}

// Boolean per line: true when the line starts inside a Lua long string
// literal and must not be treated as a divider. Tracks long comments and
// short strings so `[[` inside `-- comment`, `--[[ block ]]`, or
// `"..."` / `'...'` never opens a string. Lines that merely open or close
// a string on the same line can't match divider patterns anyway.
function computeLongStringMask(document) {
  const mask = new Array(document.lineCount).fill(false);
  let stringEq = null;
  let commentEq = null;
  for (let idx = 0; idx < document.lineCount; idx++) {
    const text = document.lineAt(idx).text;
    mask[idx] = stringEq !== null;
    let col = 0;
    while (col < text.length) {
      if (stringEq !== null) {
        if (isLongBracketCloser(text, col, stringEq)) {
          col += stringEq + 2;
          stringEq = null;
          continue;
        }
        col++;
        continue;
      }
      if (commentEq !== null) {
        if (isLongBracketCloser(text, col, commentEq)) {
          col += commentEq + 2;
          commentEq = null;
          continue;
        }
        col++;
        continue;
      }
      if (text[col] === '-' && text[col + 1] === '-') {
        const eq = getLongBracketOpener(text, col + 2);
        if (eq >= 0) {
          commentEq = eq;
          col += 2 + eq + 2;
          continue;
        }
        break;
      }
      if (text[col] === '"' || text[col] === "'") {
        const quote = text[col];
        col++;
        while (col < text.length) {
          if (text[col] === '\\') {
            col += 2;
            continue;
          }
          if (text[col] === quote) {
            col++;
            break;
          }
          col++;
        }
        continue;
      }
      if (text[col] === '[') {
        const eq = getLongBracketOpener(text, col);
        if (eq >= 0) {
          stringEq = eq;
          col += eq + 2;
          continue;
        }
        col++;
        continue;
      }
      col++;
    }
  }
  return mask;
}

function findDividerSections(document, separatorLength, allowCommentedSeparators) {
  const mainSeparator = new RegExp(
    `^\\s*-{${separatorLength}}\\s*$`
  );

  const commentedMainSeparator = allowCommentedSeparators
    ? new RegExp(`^\\s*--\\s*-{${separatorLength}}\\s*$`)
    : null;

  const headers = [];

  const longStringMask = computeLongStringMask(document);

  for (let i = 0; i < document.lineCount - 2; i++) {
    // Skip dividers inside Lua long string literals (`[[ ... ]]`,
    // `[=[ ... ]=]`, ...). Any of the 3 banner lines inside is enough.
    if (longStringMask[i] || longStringMask[i + 1] || longStringMask[i + 2]) {
      continue;
    }
    const first = document.lineAt(i).text;
    const title = document.lineAt(i + 1).text;
    const third = document.lineAt(i + 2).text;

    const firstMatches = mainSeparator.test(first) ||
      (commentedMainSeparator && commentedMainSeparator.test(first));
    const thirdMatches = mainSeparator.test(third) ||
      (commentedMainSeparator && commentedMainSeparator.test(third));

    if (!firstMatches || !thirdMatches) {
      continue;
    }

    const titleMatch = /^\s*--\s*(.*?)\s*$/.exec(title);
    if (!titleMatch || !titleMatch[1]) {
      continue;
    }

    // Prevent the same banner from being detected twice if separators overlap.
    if (headers.length && i <= headers[headers.length - 1].endLine) {
      continue;
    }

    headers.push({
      startLine: i,
      endLine: i + 2,
      titleLine: i + 1,
      name: titleMatch[1]
    });
    i += 2;
  }

  return headers;
}

function formatLineRange(startLine, endLine) {
  return startLine === endLine ? String(startLine) : `${startLine}-${endLine}`;
}

function symbolDetail(showHintText, showLineNumbers, hint, startLine, endLine) {
  if (showLineNumbers) {
    return formatLineRange(startLine, endLine);
  }
  return showHintText ? hint : '';
}

function buildSubheaderRegExp(subheadersEnabled, subMin, subMax) {
  if (!subheadersEnabled) {
    return null;
  }
  // Leading dashes are optional so both the legacy symmetric style
  // (`-- --- Title ---`) and the padded style (`-- Title ---...`) match.
  return new RegExp(
    `^\\s*--\\s+(?:-{${subMin},${subMax}}\\s+)?(.+?)\\s+-{${subMin},${subMax}}\\s*$`
  );
}

function getDividerConfig(document) {
  const config = vscode.workspace.getConfiguration('luaDividerOutline', document.uri);
  const separatorLength = config.get('separatorLength', 70);
  const allowCommentedSeparators = config.get('allowCommentedSeparators', true);
  const subheadersEnabled = config.get('subheaders.enabled', true);
  const subMin = config.get('subheaders.minimumDashLength', 2);
  const subMax = config.get('subheaders.maximumDashLength', 200);
  return {
    separatorLength,
    allowCommentedSeparators,
    subheader: buildSubheaderRegExp(subheadersEnabled, subMin, subMax)
  };
}

function collectChildMatches(document, header, endLine, subheader) {
  const childMatches = [];
  if (!subheader) {
    return childMatches;
  }
  const longStringMask = computeLongStringMask(document);
  for (let line = header.endLine + 1; line <= endLine; line++) {
    if (longStringMask[line]) {
      continue;
    }
    const match = subheader.exec(document.lineAt(line).text);
    if (!match || !match[1]) {
      continue;
    }
    childMatches.push({ line, name: match[1].trim() });
  }
  return childMatches;
}

function childEndLine(childMatches, childIndex, sectionBound) {
  const nextChild = childMatches[childIndex + 1];
  const rawEnd = (nextChild ? nextChild.line : sectionBound) - 1;
  // Clamp so a child never reaches past its parent section.
  return Math.min(rawEnd, sectionBound - 1);
}

// Range (inclusive line numbers) of the divider entry enclosing `line`.
// Returns { startLine, endLine, kind: 'section' | 'subsection', name } or null
// when the line is not inside any divider. Ranges match the Outline exactly:
// a main section runs to the line before the next section (or EOF) and a
// subsection runs to the line before the next subsection or section.
function findEnclosingDivider(document, line) {
  if (line < 0 || line >= document.lineCount) {
    return null;
  }
  const { separatorLength, allowCommentedSeparators, subheader } = getDividerConfig(document);
  const mainHeaders = findDividerSections(document, separatorLength, allowCommentedSeparators);

  if (mainHeaders.length > 0) {
    for (let index = 0; index < mainHeaders.length; index++) {
      const header = mainHeaders[index];
      const next = mainHeaders[index + 1];
      const endLine = next ? Math.max(header.endLine, next.startLine - 1) : document.lineCount - 1;
      if (line < header.startLine || line > endLine) {
        continue;
      }
      const sectionBound = endLine + 1;
      const childMatches = collectChildMatches(document, header, endLine, subheader);
      for (let childIndex = 0; childIndex < childMatches.length; childIndex++) {
        const child = childMatches[childIndex];
        const childEnd = childEndLine(childMatches, childIndex, sectionBound);
        const safeEnd = Math.max(child.line, childEnd);
        if (line >= child.line && line <= safeEnd) {
          return { startLine: child.line, endLine: safeEnd, kind: 'subsection', name: child.name };
        }
      }
      return { startLine: header.startLine, endLine, kind: 'section', name: header.name.trim() };
    }
    return null;
  }

  if (!subheader) {
    return null;
  }
  const subheaderMatches = [];
  const longStringMask = computeLongStringMask(document);
  for (let scan = 0; scan < document.lineCount; scan++) {
    if (longStringMask[scan]) {
      continue;
    }
    const match = subheader.exec(document.lineAt(scan).text);
    if (!match || !match[1]) {
      continue;
    }
    subheaderMatches.push({ line: scan, name: match[1].trim() });
  }
  for (let index = 0; index < subheaderMatches.length; index++) {
    const match = subheaderMatches[index];
    const nextMatch = subheaderMatches[index + 1];
    const endLine = (nextMatch ? nextMatch.line : document.lineCount) - 1;
    const safeEnd = Math.max(match.line, endLine);
    if (line >= match.line && line <= safeEnd) {
      return { startLine: match.line, endLine: safeEnd, kind: 'subsection', name: match.name };
    }
  }
  return null;
}

// Distinct outermost divider ranges for a set of cursor lines. Nested hits
// (a subsection inside its own section via multiple cursors) collapse to the
// outermost range so a single edit never touches overlapping ranges.
function collectDividerTargets(document, lines) {
  const found = [];
  for (const line of lines) {
    const target = findEnclosingDivider(document, line);
    if (target) {
      found.push(target);
    }
  }
  found.sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);
  const deduped = [];
  for (const candidate of found) {
    const last = deduped[deduped.length - 1];
    if (last && candidate.startLine === last.startLine && candidate.endLine === last.endLine) {
      continue;
    }
    if (last && candidate.startLine <= last.endLine) {
      continue;
    }
    deduped.push(candidate);
  }
  return deduped;
}

// Full-line delete range: extends to the start of the next line when possible
// so no stray empty line is left behind. For a trailing section it runs to the
// end of the file.
function deleteRangeOf(document, target) {
  const start = new vscode.Position(target.startLine, 0);
  if (target.endLine + 1 < document.lineCount) {
    return new vscode.Range(start, new vscode.Position(target.endLine + 1, 0));
  }
  return new vscode.Range(
    start,
    new vscode.Position(target.endLine, document.lineAt(target.endLine).text.length)
  );
}

class LuaDividerOutlineProvider {
  provideDocumentSymbols(document) {
    if (document.languageId !== 'lua') {
      return [];
    }

    const config = vscode.workspace.getConfiguration('luaDividerOutline', document.uri);
    const separatorLength = config.get('separatorLength', 70);
    const allowCommentedSeparators = config.get('allowCommentedSeparators', true);
    const subheadersEnabled = config.get('subheaders.enabled', true);
    const subMin = config.get('subheaders.minimumDashLength', 2);
    const subMax = config.get('subheaders.maximumDashLength', 200);
    const showHintText = config.get('showHintText', false);
    const showLineNumbers = config.get('showLineNumbers', true);

    // Example:
    // -- Example text ------------------------------------------------------
    const subheader = buildSubheaderRegExp(subheadersEnabled, subMin, subMax);

    const symbols = [];
    const mainHeaders = findDividerSections(document, separatorLength, allowCommentedSeparators);

    // Main headers become top-level symbols. Their ranges extend to the next
    // main header, allowing nested subheaders and ordinary LuaLS symbols to sit
    // conceptually inside the section in the Outline.
    for (let index = 0; index < mainHeaders.length; index++) {
      const header = mainHeaders[index];
      const next = mainHeaders[index + 1];
      const endLine = next ? Math.max(header.endLine, next.startLine - 1) : document.lineCount - 1;
      const sectionBound = endLine + 1;

      const childMatches = collectChildMatches(document, header, endLine, subheader);

      // Children are properly nested: each child's range is contained in the
      // parent's range, sibling ranges never overlap, and each child spans to
      // the line before the next child (or to the end of the parent section).
      const childSymbols = childMatches.map((child, childIndex) => {
        const childEnd = childEndLine(childMatches, childIndex, sectionBound);
        const safeEnd = Math.max(child.line, childEnd);
        const range = new vscode.Range(
          new vscode.Position(child.line, 0),
          new vscode.Position(safeEnd, document.lineAt(safeEnd).text.length)
        );
        const selectionRange = document.lineAt(child.line).range;

        return new vscode.DocumentSymbol(
          child.name,
          symbolDetail(showHintText, showLineNumbers, 'divider subsection', child.line + 1, safeEnd + 1),
          SUBHEADER_KIND,
          range,
          selectionRange
        );
      });

      const range = new vscode.Range(
        new vscode.Position(header.startLine, 0),
        new vscode.Position(endLine, document.lineAt(endLine).text.length)
      );
      const selectionRange = new vscode.Range(
        new vscode.Position(header.titleLine, 0),
        new vscode.Position(header.titleLine, document.lineAt(header.titleLine).text.length)
      );

      symbols.push(new vscode.DocumentSymbol(
        header.name.trim(),
        symbolDetail(showHintText, showLineNumbers, 'divider section', header.startLine + 1, endLine + 1),
        MAIN_KIND,
        range,
        selectionRange
      ));

      // Nested subheaders are attached to their main divider section.
      symbols[symbols.length - 1].children = childSymbols;
    }

    // Files containing only subheaders still get useful Outline entries.
    // Each entry spans to the next subheader (or EOF) so siblings nest
    // without overlapping, exactly like children under a main section.
    if (symbols.length === 0 && subheader) {
      const subheaderMatches = [];
      const longStringMask = computeLongStringMask(document);
      for (let line = 0; line < document.lineCount; line++) {
        if (longStringMask[line]) {
          continue;
        }
        const match = subheader.exec(document.lineAt(line).text);
        if (!match || !match[1]) {
          continue;
        }

        subheaderMatches.push({ line, name: match[1].trim() });
      }

      for (let index = 0; index < subheaderMatches.length; index++) {
        const match = subheaderMatches[index];
        const nextMatch = subheaderMatches[index + 1];
        const endLine = (nextMatch ? nextMatch.line : document.lineCount) - 1;
        const safeEnd = Math.max(match.line, endLine);
        const range = new vscode.Range(
          new vscode.Position(match.line, 0),
          new vscode.Position(safeEnd, document.lineAt(safeEnd).text.length)
        );
        const selectionRange = document.lineAt(match.line).range;

        symbols.push(new vscode.DocumentSymbol(
          match.name,
          symbolDetail(showHintText, showLineNumbers, 'divider subsection', match.line + 1, safeEnd + 1),
          SUBHEADER_KIND,
          range,
          selectionRange
        ));
      }
    }

    return symbols;
  }
}

function clampSeparatorLength(value) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) {
    return 70;
  }
  return Math.max(1, Math.min(500, parsed));
}

function sanitizeTitle(value) {
  const title = String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim();
  return title || DEFAULT_SECTION_TITLE;
}

function sanitizeTitleWithFallback(value, fallback) {
  const title = String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim();
  return title || fallback;
}

function clampInsertDashCount(value) {
  // Deprecated: subsections are now padded to a total line length instead of
  // using a fixed per-side dash count. Kept for backward compatibility.
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) {
    return 30;
  }
  return Math.max(1, Math.min(500, parsed));
}

// Total line length (excluding leading whitespace) for a padded subsection
// line of the form `-- Title ----...`. Trailing dashes fill the remainder,
// clamped into the detectable dash range so the new line is picked up.
function trailingDashCountFor(title, totalLength, subMin, subMax) {
  const prefixLength = 3 + title.length + 1;
  const raw = totalLength - prefixLength;
  const lo = Math.max(1, subMin);
  const hi = Math.max(lo, subMax);
  return Math.min(Math.max(raw, lo), hi);
}

function buildDividerInsertions(document, selections, separatorLength, title) {
  const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  const separator = '-'.repeat(separatorLength);
  const entries = [];

  for (const selection of selections) {
    const position = selection.active;
    const line = document.lineAt(position.line);
    const indent = /^[ \t]*/.exec(line.text)[0];
    const before = line.text.slice(0, position.character);
    const after = line.text.slice(position.character);

    const leadingBreak = before.length > 0;
    const trailingBreak = after.length > 0 || line.text.length === 0;

    const insertText =
      (leadingBreak ? eol : '') +
      [indent + separator, indent + '-- ' + title, indent + separator].join(eol) +
      (trailingBreak ? eol : '');

    entries.push({
      offset: document.offsetAt(position),
      titleOffset:
        (leadingBreak ? eol.length : 0) +
        indent.length +
        separator.length +
        eol.length +
        indent.length +
        3,
      insertText
    });
  }

  return entries;
}

async function insertDividerSection() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'lua') {
    return;
  }

  const document = editor.document;
  const config = vscode.workspace.getConfiguration('luaDividerOutline', document.uri);
  const separatorLength = clampSeparatorLength(config.get('separatorLength', 70));
  const title = sanitizeTitle(config.get('insert.defaultTitle', DEFAULT_SECTION_TITLE));

  const entries = buildDividerInsertions(document, editor.selections, separatorLength, title);

  const ordered = entries.slice().sort((a, b) => a.offset - b.offset);
  let shifted = 0;
  for (const entry of ordered) {
    entry.titleStartOffset = entry.offset + shifted + entry.titleOffset;
    shifted += entry.insertText.length;
  }

  const applied = await editor.edit(
    (editBuilder) => {
      for (const entry of entries) {
        editBuilder.insert(document.positionAt(entry.offset), entry.insertText);
      }
    },
    { undoStopBefore: true, undoStopAfter: true }
  );

  if (!applied) {
    return;
  }

  const updated = editor.document;
  editor.selections = entries.map(
    (entry) =>
      new vscode.Selection(
        updated.positionAt(entry.titleStartOffset),
        updated.positionAt(entry.titleStartOffset + title.length)
      )
  );
}

function buildSubheaderInsertions(document, selections, dashCount, title) {
  const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  const dashes = '-'.repeat(Math.max(1, Math.floor(dashCount) || 1));
  const entries = [];

  for (const selection of selections) {
    const position = selection.active;
    const line = document.lineAt(position.line);
    const indent = /^[ \t]*/.exec(line.text)[0];
    const before = line.text.slice(0, position.character);
    const after = line.text.slice(position.character);

    const leadingBreak = before.length > 0;
    const trailingBreak = after.length > 0 || line.text.length === 0;

    const lineText = indent + '-- ' + title + ' ' + dashes;
    const insertText =
      (leadingBreak ? eol : '') +
      lineText +
      (trailingBreak ? eol : '');

    entries.push({
      offset: document.offsetAt(position),
      titleOffset:
        (leadingBreak ? eol.length : 0) +
        indent.length +
        3,
      insertText
    });
  }

  return entries;
}

async function insertDividerSubsection() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'lua') {
    return;
  }

  const document = editor.document;
  const config = vscode.workspace.getConfiguration('luaDividerOutline', document.uri);
  const subMin = Math.max(1, Math.floor(Number(config.get('subheaders.minimumDashLength', 2))) || 2);
  const subMax = Math.max(subMin, Math.floor(Number(config.get('subheaders.maximumDashLength', 200))) || 200);
  // Reuse the configured insert title when the user customized it, otherwise
  // pre-fill "Subsection" so the two insert commands stay distinct.
  const rawTitle = sanitizeTitleWithFallback(config.get('insert.defaultTitle', ''), '');
  const title = rawTitle && rawTitle !== DEFAULT_SECTION_TITLE ? rawTitle : DEFAULT_SUBSECTION_TITLE;
  // Pad the trailing dashes so the line (excluding leading whitespace) totals
  // `separatorLength` (70 by default): `-- Title ----...`.
  const totalLength = clampSeparatorLength(config.get('separatorLength', 70));
  const dashCount = trailingDashCountFor(title, totalLength, subMin, subMax);

  const entries = buildSubheaderInsertions(document, editor.selections, dashCount, title);

  const ordered = entries.slice().sort((a, b) => a.offset - b.offset);
  let shifted = 0;
  for (const entry of ordered) {
    entry.titleStartOffset = entry.offset + shifted + entry.titleOffset;
    shifted += entry.insertText.length;
  }

  const applied = await editor.edit(
    (editBuilder) => {
      for (const entry of entries) {
        editBuilder.insert(document.positionAt(entry.offset), entry.insertText);
      }
    },
    { undoStopBefore: true, undoStopAfter: true }
  );

  if (!applied) {
    return;
  }

  const updated = editor.document;
  editor.selections = entries.map(
    (entry) =>
      new vscode.Selection(
        updated.positionAt(entry.titleStartOffset),
        updated.positionAt(entry.titleStartOffset + title.length)
      )
  );
}

// Sorted jump stops for Go to Next/Previous: one per section plus, when
// enabled, one per subsection. Each stop is { startLine, endLine, titleLine }.
function collectGoToStops(document) {
  const config = vscode.workspace.getConfiguration('luaDividerOutline', document.uri);
  const separatorLength = config.get('separatorLength', 70);
  const allowCommentedSeparators = config.get('allowCommentedSeparators', true);
  const includeSubs = config.get('navigation.includeSubheaders', true);
  const { subheader } = getDividerConfig(document);
  const stops = [];
  const sections = findDividerSections(document, separatorLength, allowCommentedSeparators);

  for (let index = 0; index < sections.length; index++) {
    const header = sections[index];
    const next = sections[index + 1];
    const endLine = next ? Math.max(header.endLine, next.startLine - 1) : document.lineCount - 1;
    stops.push({ startLine: header.startLine, endLine, titleLine: header.titleLine });
    if (includeSubs && subheader) {
      const sectionBound = endLine + 1;
      const childMatches = collectChildMatches(document, header, endLine, subheader);
      for (let childIndex = 0; childIndex < childMatches.length; childIndex++) {
        const child = childMatches[childIndex];
        const safeEnd = Math.max(child.line, childEndLine(childMatches, childIndex, sectionBound));
        stops.push({ startLine: child.line, endLine: safeEnd, titleLine: child.line });
      }
    }
  }

  // Files with only subheaders still get jump stops.
  if (stops.length === 0 && includeSubs && subheader) {
    const longStringMask = computeLongStringMask(document);
    const matches = [];
    for (let line = 0; line < document.lineCount; line++) {
      if (longStringMask[line]) {
        continue;
      }
      const match = subheader.exec(document.lineAt(line).text);
      if (match && match[1]) {
        matches.push({ line });
      }
    }
    for (let index = 0; index < matches.length; index++) {
      const current = matches[index];
      const following = matches[index + 1];
      const endLine = Math.max(current.line, (following ? following.line : document.lineCount) - 1);
      stops.push({ startLine: current.line, endLine, titleLine: current.line });
    }
  }

  stops.sort((a, b) => a.startLine - b.startLine);
  return stops;
}

function goToDividerSection(direction) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'lua') {
    return;
  }

  const stops = collectGoToStops(editor.document);

  if (!stops.length) {
    vscode.window.setStatusBarMessage('No divider sections found', 3000);
    return;
  }

  const line = editor.selection.active.line;
  let target = null;

  if (direction > 0) {
    target = stops.find((stop) => stop.startLine > line) || stops[0];
  } else {
    for (let index = stops.length - 1; index >= 0; index--) {
      if (stops[index].endLine < line) {
        target = stops[index];
        break;
      }
    }
    target = target || stops[stops.length - 1];
  }

  const position = new vscode.Position(target.titleLine, 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(
    new vscode.Range(position, position),
    vscode.TextEditorRevealType.InCenterIfOutsideViewport
  );
}

function getActiveLuaEditor() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'lua') {
    vscode.window.setStatusBarMessage('No Lua divider at cursor', 3000);
    return null;
  }
  return editor;
}

function describeTarget(target) {
  const kind = target.kind === 'subsection' ? 'subsection' : 'section';
  return `${kind} '${target.name}' (lines ${target.startLine + 1}-${target.endLine + 1})`;
}

function isDividerTreeItem(value) {
  return Boolean(value) && typeof value.dividerStartLine === 'number' && typeof value.dividerEndLine === 'number';
}

// view/item/context invokes handlers as (item, selectedItems). Editor and
// palette invocations pass (uri) or nothing, so only treat args carrying our
// divider fields as tree invocations.
function collectTreeItems(firstArg, secondArg) {
  const items = [];
  const seen = new Set();
  const push = (candidate) => {
    if (!isDividerTreeItem(candidate) || seen.has(candidate)) {
      return;
    }
    seen.add(candidate);
    items.push(candidate);
  };
  push(firstArg);
  if (Array.isArray(secondArg)) {
    for (const candidate of secondArg) {
      push(candidate);
    }
  }
  return items;
}

function dedupeDividerTargets(targets) {
  const sorted = targets.slice().sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);
  const deduped = [];
  for (const candidate of sorted) {
    const last = deduped[deduped.length - 1];
    if (last && candidate.startLine === last.startLine && candidate.endLine === last.endLine) {
      continue;
    }
    if (last && candidate.startLine <= last.endLine) {
      continue;
    }
    deduped.push(candidate);
  }
  return deduped;
}

async function getEditorForDocumentUri(uri) {
  const key = uri.toString();
  const visible = (vscode.window.visibleTextEditors || []).find(
    (candidate) => candidate.document.uri.toString() === key
  );
  if (visible) {
    return visible;
  }
  const active = vscode.window.activeTextEditor;
  if (active && active.document.uri.toString() === key) {
    return active;
  }
  const document = await vscode.workspace.openTextDocument(uri);
  return vscode.window.showTextDocument(document);
}

function dividerTargetsFromTreeItems(items) {
  return dedupeDividerTargets(
    items.map((item) => ({
      startLine: item.dividerStartLine,
      endLine: item.dividerEndLine,
      kind: item.dividerKind === 'subsection' ? 'subsection' : 'section',
      name: typeof item.label === 'string' ? item.label : String(item.label || 'Section'),
    }))
  );
}

async function copyDividerSection(firstArg, secondArg) {
  const treeItems = collectTreeItems(firstArg, secondArg);
  if (treeItems.length) {
    const editor = await getEditorForDocumentUri(treeItems[0].dividerDocumentUri);
    const document = editor.document;
    const targets = dividerTargetsFromTreeItems(treeItems);
    if (!targets.length) {
      vscode.window.showInformationMessage('No divider section at cursor.');
      return;
    }
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const texts = targets.map((target) => {
      const range = new vscode.Range(
        new vscode.Position(target.startLine, 0),
        new vscode.Position(target.endLine, document.lineAt(target.endLine).text.length)
      );
      return document.getText(range);
    });
    await vscode.env.clipboard.writeText(texts.join(eol));
    vscode.window.setStatusBarMessage(
      targets.length === 1 ? `Copied ${describeTarget(targets[0])}` : `Copied ${targets.length} divider sections`,
      3000
    );
    return;
  }
  const editor = getActiveLuaEditor();
  if (!editor) {
    return;
  }
  const document = editor.document;
  const lines = editor.selections.map((selection) => selection.active.line);
  const targets = collectDividerTargets(document, lines);
  if (!targets.length) {
    vscode.window.showInformationMessage('No divider section at cursor.');
    return;
  }
  const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  const texts = targets.map((target) => {
    const range = new vscode.Range(
      new vscode.Position(target.startLine, 0),
      new vscode.Position(target.endLine, document.lineAt(target.endLine).text.length)
    );
    return document.getText(range);
  });
  await vscode.env.clipboard.writeText(texts.join(eol));
  vscode.window.setStatusBarMessage(
    targets.length === 1 ? `Copied ${describeTarget(targets[0])}` : `Copied ${targets.length} divider sections`,
    3000
  );
}

async function cutDividerSection(firstArg, secondArg) {
  const treeItems = collectTreeItems(firstArg, secondArg);
  if (treeItems.length) {
    const editor = await getEditorForDocumentUri(treeItems[0].dividerDocumentUri);
    const document = editor.document;
    const targets = dividerTargetsFromTreeItems(treeItems);
    if (!targets.length) {
      vscode.window.showInformationMessage('No divider section at cursor.');
      return;
    }
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const texts = targets.map((target) => {
      const range = new vscode.Range(
        new vscode.Position(target.startLine, 0),
        new vscode.Position(target.endLine, document.lineAt(target.endLine).text.length)
      );
      return document.getText(range);
    });
    await vscode.env.clipboard.writeText(texts.join(eol));
    const deleteRanges = targets.map((target) => deleteRangeOf(document, target));
    const applied = await editor.edit(
      (editBuilder) => {
        for (const range of deleteRanges) {
          editBuilder.delete(range);
        }
      },
      { undoStopBefore: true, undoStopAfter: true }
    );
    if (applied) {
      const anchor = deleteRanges[0].start;
      const clamped = Math.min(anchor.line, Math.max(0, editor.document.lineCount - 1));
      const position = new vscode.Position(clamped, 0);
      editor.selections = [new vscode.Selection(position, position)];
      vscode.window.setStatusBarMessage(
        targets.length === 1 ? `Cut ${describeTarget(targets[0])}` : `Cut ${targets.length} divider sections`,
        3000
      );
    }
    return;
  }
  const editor = getActiveLuaEditor();
  if (!editor) {
    return;
  }
  const document = editor.document;
  const lines = editor.selections.map((selection) => selection.active.line);
  const targets = collectDividerTargets(document, lines);
  if (!targets.length) {
    vscode.window.showInformationMessage('No divider section at cursor.');
    return;
  }
  const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  const texts = targets.map((target) => {
    const range = new vscode.Range(
      new vscode.Position(target.startLine, 0),
      new vscode.Position(target.endLine, document.lineAt(target.endLine).text.length)
    );
    return document.getText(range);
  });
  await vscode.env.clipboard.writeText(texts.join(eol));
  const deleteRanges = targets.map((target) => deleteRangeOf(document, target));
  const applied = await editor.edit(
    (editBuilder) => {
      for (const range of deleteRanges) {
        editBuilder.delete(range);
      }
    },
    { undoStopBefore: true, undoStopAfter: true }
  );
  if (applied) {
    const anchor = deleteRanges[0].start;
    const clamped = Math.min(anchor.line, Math.max(0, editor.document.lineCount - 1));
    const position = new vscode.Position(clamped, 0);
    editor.selections = [new vscode.Selection(position, position)];
    vscode.window.setStatusBarMessage(
      targets.length === 1 ? `Cut ${describeTarget(targets[0])}` : `Cut ${targets.length} divider sections`,
      3000
    );
  }
}

async function deleteDividerSection(firstArg, secondArg) {
  const treeItems = collectTreeItems(firstArg, secondArg);
  if (treeItems.length) {
    const editor = await getEditorForDocumentUri(treeItems[0].dividerDocumentUri);
    const document = editor.document;
    const targets = dividerTargetsFromTreeItems(treeItems);
    if (!targets.length) {
      vscode.window.showInformationMessage('No divider section at cursor.');
      return;
    }
    const deleteRanges = targets.map((target) => deleteRangeOf(document, target));
    const applied = await editor.edit(
      (editBuilder) => {
        for (const range of deleteRanges) {
          editBuilder.delete(range);
        }
      },
      { undoStopBefore: true, undoStopAfter: true }
    );
    if (applied) {
      const anchor = deleteRanges[0].start;
      const clamped = Math.min(anchor.line, Math.max(0, editor.document.lineCount - 1));
      const position = new vscode.Position(clamped, 0);
      editor.selections = [new vscode.Selection(position, position)];
      vscode.window.setStatusBarMessage(
        targets.length === 1 ? `Deleted ${describeTarget(targets[0])}` : `Deleted ${targets.length} divider sections`,
        3000
      );
    }
    return;
  }
  const editor = getActiveLuaEditor();
  if (!editor) {
    return;
  }
  const document = editor.document;
  const lines = editor.selections.map((selection) => selection.active.line);
  const targets = collectDividerTargets(document, lines);
  if (!targets.length) {
    vscode.window.showInformationMessage('No divider section at cursor.');
    return;
  }
  const deleteRanges = targets.map((target) => deleteRangeOf(document, target));
  const applied = await editor.edit(
    (editBuilder) => {
      for (const range of deleteRanges) {
        editBuilder.delete(range);
      }
    },
    { undoStopBefore: true, undoStopAfter: true }
  );
  if (applied) {
    const anchor = deleteRanges[0].start;
    const clamped = Math.min(anchor.line, Math.max(0, editor.document.lineCount - 1));
    const position = new vscode.Position(clamped, 0);
    editor.selections = [new vscode.Selection(position, position)];
    vscode.window.setStatusBarMessage(
      targets.length === 1 ? `Deleted ${describeTarget(targets[0])}` : `Deleted ${targets.length} divider sections`,
      3000
    );
  }
}

async function selectDividerSection(firstArg, secondArg) {
  const selectTargets = (editor, document, targets) => {
    if (!targets.length) {
      vscode.window.showInformationMessage('No divider section at cursor.');
      return;
    }
    const selections = targets.map((target) => {
      const startLine = Math.max(0, Math.min(target.startLine, document.lineCount - 1));
      const endLine = Math.max(startLine, Math.min(target.endLine, document.lineCount - 1));
      const range = new vscode.Range(
        new vscode.Position(startLine, 0),
        new vscode.Position(endLine, document.lineAt(endLine).text.length)
      );
      return new vscode.Selection(range.start, range.end);
    });
    editor.selections = selections;
    const first = targets[0];
    const last = targets[targets.length - 1];
    editor.revealRange(
      new vscode.Range(
        new vscode.Position(Math.max(0, Math.min(first.startLine, document.lineCount - 1)), 0),
        new vscode.Position(
          Math.max(0, Math.min(last.endLine, document.lineCount - 1)),
          document.lineAt(Math.max(0, Math.min(last.endLine, document.lineCount - 1))).text.length
        )
      ),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport
    );
    vscode.window.setStatusBarMessage(
      targets.length === 1 ? `Selected ${describeTarget(targets[0])}` : `Selected ${targets.length} divider sections`,
      3000
    );
  };

  const treeItems = collectTreeItems(firstArg, secondArg);
  if (treeItems.length) {
    const editor = await getEditorForDocumentUri(treeItems[0].dividerDocumentUri);
    selectTargets(editor, editor.document, dividerTargetsFromTreeItems(treeItems));
    return;
  }
  const editor = getActiveLuaEditor();
  if (!editor) {
    return;
  }
  const document = editor.document;
  const lines = editor.selections.map((selection) => selection.active.line);
  selectTargets(editor, document, collectDividerTargets(document, lines));
}

// Pure title-line rewriters used by rename. Sections preserve indentation
// and only swap the title text. Subsections preserve indentation (and any
// legacy leading dashes) but re-pad the trailing dashes so the line
// (excluding leading whitespace) still totals `separatorLength`, like
// Insert Subsection. Return null when the line does not match the expected
// divider shape.
function renamedSectionTitleLine(lineText, newTitle) {
  const match = /^(\s*--\s*)(.*?)(\s*)$/.exec(lineText);
  if (!match || !match[2] || /^-+$/.test(match[2].trim())) {
    return null;
  }
  return match[1] + newTitle + match[3];
}

function renamedSubsectionLine(lineText, newTitle, totalLength, subMin, subMax) {
  const match = /^(\s*--\s+(?:-+\s+)?)(.+?)(\s+-+\s*)$/.exec(lineText);
  if (!match) {
    return null;
  }
  // Without a target length there is nothing to pad to: preserve the
  // original dash run (legacy behavior, kept for backward compatibility).
  if (!Number.isFinite(Number(totalLength))) {
    return match[1] + newTitle + match[3];
  }
  const target = Math.floor(Number(totalLength));
  const indentMatch = /^[ \t]*/.exec(lineText);
  const indent = indentMatch ? indentMatch[0] : '';
  const prefix = match[1];
  // Prefix without leading whitespace (e.g. `-- ` or `-- --- ` when the
  // legacy leading-dash style is used). Preserved as-is; only the trailing
  // dashes are re-padded so the line (excluding leading whitespace) totals
  // `separatorLength`, exactly like Insert Divider Subsection.
  const prefixWithoutIndent = prefix.slice(indent.length);
  const lo = Math.max(1, Math.floor(Number(subMin)) || 2);
  const hi = Math.max(lo, Math.floor(Number(subMax)) || 200);
  const raw = target - (prefixWithoutIndent.length + newTitle.length + 1);
  const dashCount = Math.min(Math.max(raw, lo), hi);
  return indent + prefixWithoutIndent + newTitle + ' ' + '-'.repeat(dashCount);
}

function findSectionHeaderByStart(document, startLine) {
  const { separatorLength, allowCommentedSeparators } = getDividerConfig(document);
  const headers = findDividerSections(document, separatorLength, allowCommentedSeparators);
  return headers.find((header) => header.startLine === startLine) || null;
}

async function renameDividerSection(firstArg, secondArg) {
  const treeItems = collectTreeItems(firstArg, secondArg);
  let editor;
  let target;
  if (treeItems.length) {
    const item = treeItems[0];
    editor = await getEditorForDocumentUri(item.dividerDocumentUri);
    const kind = item.dividerKind === 'subsection' ? 'subsection' : 'section';
    target = {
      startLine: item.dividerStartLine,
      endLine: item.dividerEndLine,
      kind,
      name: typeof item.label === 'string' ? item.label : String(item.label || 'Section'),
    };
    // Guard against a stale tree row (edited since the tree was rendered).
    const flat = flattenDividerEntries(dividerTreeEntries(editor.document));
    const current = flat.find(
      (entry) => entry.startLine === target.startLine && entry.endLine === target.endLine && entry.kind === target.kind
    );
    if (!current) {
      vscode.window.showInformationMessage('That divider changed, try again.');
      return;
    }
    target.name = current.label;
  } else {
    editor = getActiveLuaEditor();
    if (!editor) {
      return;
    }
    const found = findEnclosingDivider(editor.document, editor.selection.active.line);
    if (!found) {
      vscode.window.showInformationMessage('No divider section at cursor.');
      return;
    }
    target = found;
  }

  const document = editor.document;
  const newName = await vscode.window.showInputBox({
    value: target.name,
    prompt: target.kind === 'subsection' ? 'Rename divider subsection' : 'Rename divider section',
    validateInput: (value) => (String(value).trim() ? undefined : 'Title cannot be empty.'),
  });
  if (newName == null) {
    return;
  }
  const trimmed = String(newName).replace(/[\r\n]+/g, ' ').trim();
  if (!trimmed || trimmed === target.name) {
    return;
  }

  let titleLine;
  let newLineText;
  if (target.kind === 'section') {
    const header = findSectionHeaderByStart(document, target.startLine);
    if (!header) {
      vscode.window.showInformationMessage('That divider changed, try again.');
      return;
    }
    titleLine = header.titleLine;
    newLineText = renamedSectionTitleLine(document.lineAt(titleLine).text, trimmed);
  } else {
    titleLine = target.startLine;
    // Re-pad trailing dashes so the renamed line (excluding leading
    // whitespace) still totals `separatorLength`, like Insert Subsection.
    const renameConfig = vscode.workspace.getConfiguration('luaDividerOutline', document.uri);
    const totalLength = clampSeparatorLength(renameConfig.get('separatorLength', 70));
    const renameSubMin = Math.max(1, Math.floor(Number(renameConfig.get('subheaders.minimumDashLength', 2))) || 2);
    const renameSubMax = Math.max(renameSubMin, Math.floor(Number(renameConfig.get('subheaders.maximumDashLength', 200))) || 200);
    newLineText = renamedSubsectionLine(document.lineAt(titleLine).text, trimmed, totalLength, renameSubMin, renameSubMax);
  }
  if (newLineText == null) {
    vscode.window.showInformationMessage('That divider changed, try again.');
    return;
  }

  const applied = await editor.edit(
    (editBuilder) => {
      editBuilder.replace(
        new vscode.Range(
          new vscode.Position(titleLine, 0),
          new vscode.Position(titleLine, document.lineAt(titleLine).text.length)
        ),
        newLineText
      );
    },
    { undoStopBefore: true, undoStopAfter: true }
  );
  if (applied) {
    const position = new vscode.Position(titleLine, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    vscode.window.setStatusBarMessage(`Renamed to '${trimmed}'`, 3000);
  }
}

async function duplicateDividerSection(firstArg, secondArg) {
  const treeItems = collectTreeItems(firstArg, secondArg);
  let editor;
  let targets;
  if (treeItems.length) {
    editor = await getEditorForDocumentUri(treeItems[0].dividerDocumentUri);
    targets = dividerTargetsFromTreeItems(treeItems);
  } else {
    editor = getActiveLuaEditor();
    if (!editor) {
      return;
    }
    const lines = editor.selections.map((selection) => selection.active.line);
    targets = collectDividerTargets(editor.document, lines);
  }
  if (!targets.length) {
    vscode.window.showInformationMessage('No divider section at cursor.');
    return;
  }

  const document = editor.document;
  const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  // Insert descending so earlier insert positions stay valid in one edit.
  const ordered = targets.slice().sort((a, b) => b.startLine - a.startLine);
  const copies = ordered.map((target) =>
    document.getText(
      new vscode.Range(
        new vscode.Position(target.startLine, 0),
        new vscode.Position(target.endLine, document.lineAt(target.endLine).text.length)
      )
    )
  );
  const applied = await editor.edit(
    (editBuilder) => {
      ordered.forEach((target, index) => {
        if (target.endLine + 1 < document.lineCount) {
          editBuilder.insert(new vscode.Position(target.endLine + 1, 0), copies[index] + eol);
        } else {
          editBuilder.insert(
            new vscode.Position(target.endLine, document.lineAt(target.endLine).text.length),
            eol + copies[index]
          );
        }
      });
    },
    { undoStopBefore: true, undoStopAfter: true }
  );
  if (!applied) {
    return;
  }
  // The first (topmost) copy starts right after its original.
  const first = targets.slice().sort((a, b) => a.startLine - b.startLine)[0];
  const titleLine = Math.min(
    editor.document.lineCount - 1,
    first.endLine + 1 + (first.kind === 'subsection' ? 0 : 1)
  );
  const position = new vscode.Position(Math.max(0, titleLine), 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  vscode.window.setStatusBarMessage(
    targets.length === 1 ? `Duplicated ${describeTarget(first)}` : `Duplicated ${targets.length} divider sections`,
    3000
  );
}

async function moveDividerSection(direction, firstArg, secondArg) {
  const treeItems = collectTreeItems(firstArg, secondArg);
  let editor;
  let target;
  if (treeItems.length) {
    if (treeItems.length > 1) {
      vscode.window.showInformationMessage('Move one divider at a time.');
      return;
    }
    const item = treeItems[0];
    editor = await getEditorForDocumentUri(item.dividerDocumentUri);
    target = {
      startLine: item.dividerStartLine,
      endLine: item.dividerEndLine,
      kind: item.dividerKind === 'subsection' ? 'subsection' : 'section',
      name: typeof item.label === 'string' ? item.label : String(item.label || 'Section'),
    };
  } else {
    editor = getActiveLuaEditor();
    if (!editor) {
      return;
    }
    const found = findEnclosingDivider(editor.document, editor.selection.active.line);
    if (!found) {
      vscode.window.showInformationMessage('No divider section at cursor.');
      return;
    }
    target = found;
  }

  const document = editor.document;
  const entries = dividerTreeEntries(document);
  let siblings;
  if (target.kind === 'section') {
    siblings = entries.filter((entry) => entry.kind === 'section');
  } else {
    const parent = findParentSectionForLine(entries, target.startLine);
    siblings = parent ? parent.children || [] : entries.filter((entry) => entry.kind !== 'section');
  }
  const index = siblings.findIndex((entry) => entry.startLine === target.startLine);
  if (index < 0) {
    vscode.window.showInformationMessage('That divider changed, try again.');
    return;
  }
  const neighbor = siblings[index + direction];
  if (!neighbor) {
    vscode.window.setStatusBarMessage(
      direction < 0 ? 'Already at the top.' : 'Already at the bottom.',
      3000
    );
    return;
  }
  // Swap by moving the target before/after its neighbor via the shared
  // line-reorder helper (single undo step, terminator-safe).
  const insertLine = direction < 0 ? neighbor.startLine : neighbor.endLine + 1;
  const result = await performDividerMove(editor, [{ ...target }], insertLine);
  if (!result) {
    return;
  }
  const titleLine = Math.max(
    0,
    Math.min(result.insertIndex + (target.kind === 'subsection' ? 0 : 1), editor.document.lineCount - 1)
  );
  const position = new vscode.Position(titleLine, 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  vscode.window.setStatusBarMessage(`Moved '${target.name}' ${direction < 0 ? 'up' : 'down'}`, 3000);
}

class DividerTreeItem extends vscode.TreeItem {
  constructor({ label, description, startLine, endLine, kind, documentUri, revealLine, collapsibleState }) {
    super(label, collapsibleState);
    this.id = `${kind}:${startLine}-${endLine}`;
    this.description = description;
    this.contextValue = kind === 'subsection' ? 'dividerSubsection' : 'dividerSection';
    this.dividerStartLine = startLine;
    this.dividerEndLine = endLine;
    this.dividerKind = kind;
    this.dividerDocumentUri = documentUri;
    this.dividerRevealLine = revealLine;
    this.command = {
      command: REVEAL_DIVIDER_COMMAND,
      title: 'Go to Divider Section',
      arguments: [this],
    };
  }
}

function dividerTreeEntries(document) {
  const config = vscode.workspace.getConfiguration('luaDividerOutline', document.uri);
  const showHintText = config.get('showHintText', false);
  const showLineNumbers = config.get('showLineNumbers', true);
  const { separatorLength, allowCommentedSeparators, subheader } = getDividerConfig(document);
  const mainHeaders = findDividerSections(document, separatorLength, allowCommentedSeparators);
  const entries = [];

  for (let index = 0; index < mainHeaders.length; index++) {
    const header = mainHeaders[index];
    const next = mainHeaders[index + 1];
    const endLine = next ? Math.max(header.endLine, next.startLine - 1) : document.lineCount - 1;
    const sectionBound = endLine + 1;
    const childMatches = collectChildMatches(document, header, endLine, subheader);
    const children = childMatches.map((child, childIndex) => {
      const childEnd = childEndLine(childMatches, childIndex, sectionBound);
      const safeEnd = Math.max(child.line, childEnd);
      return {
        label: child.name,
        description: symbolDetail(showHintText, showLineNumbers, 'divider subsection', child.line + 1, safeEnd + 1),
        startLine: child.line,
        endLine: safeEnd,
        kind: 'subsection',
        revealLine: child.line,
      };
    });
    entries.push({
      label: header.name.trim(),
      description: symbolDetail(showHintText, showLineNumbers, 'divider section', header.startLine + 1, endLine + 1),
      startLine: header.startLine,
      endLine,
      kind: 'section',
      revealLine: header.titleLine,
      children,
    });
  }

  if (entries.length === 0 && subheader) {
    const matches = [];
    const longStringMask = computeLongStringMask(document);
    for (let line = 0; line < document.lineCount; line++) {
      if (longStringMask[line]) {
        continue;
      }
      const match = subheader.exec(document.lineAt(line).text);
      if (match && match[1]) {
        matches.push({ line, name: match[1].trim() });
      }
    }
    for (let index = 0; index < matches.length; index++) {
      const match = matches[index];
      const nextMatch = matches[index + 1];
      const endLine = (nextMatch ? nextMatch.line : document.lineCount) - 1;
      const safeEnd = Math.max(match.line, endLine);
      entries.push({
        label: match.name,
        description: symbolDetail(showHintText, showLineNumbers, 'divider subsection', match.line + 1, safeEnd + 1),
        startLine: match.line,
        endLine: safeEnd,
        kind: 'subsection',
        revealLine: match.line,
        children: [],
      });
    }
  }

  return entries;
}

class DividerTreeProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return element;
  }

  getParent(element) {
    if (!isDividerTreeItem(element) || element.dividerKind !== 'subsection') {
      return null;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'lua') {
      return null;
    }
    const all = dividerTreeEntries(editor.document);
    for (const entry of all) {
      if (entry.kind !== 'section') {
        continue;
      }
      if (element.dividerStartLine >= entry.startLine && element.dividerEndLine <= entry.endLine) {
        return new DividerTreeItem({
          label: entry.label,
          description: entry.description,
          startLine: entry.startLine,
          endLine: entry.endLine,
          kind: entry.kind,
          documentUri: editor.document.uri,
          revealLine: entry.revealLine,
          collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
        });
      }
    }
    return null;
  }

  getChildren(element) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'lua') {
      return [];
    }
    const document = editor.document;
    if (!element) {
      return dividerTreeEntries(document).map(
        (entry) =>
          new DividerTreeItem({
            label: entry.label,
            description: entry.description,
            startLine: entry.startLine,
            endLine: entry.endLine,
            kind: entry.kind,
            documentUri: document.uri,
            revealLine: entry.revealLine,
            collapsibleState:
              entry.children.length > 0
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None,
          })
      );
    }
    if (element.dividerKind === 'section') {
      const all = dividerTreeEntries(document);
      const match = all.find(
        (entry) => entry.startLine === element.dividerStartLine && entry.kind === 'section'
      );
      if (!match) {
        return [];
      }
      return match.children.map(
        (child) =>
          new DividerTreeItem({
            label: child.label,
            description: child.description,
            startLine: child.startLine,
            endLine: child.endLine,
            kind: child.kind,
            documentUri: document.uri,
            revealLine: child.revealLine,
            collapsibleState: vscode.TreeItemCollapsibleState.None,
          })
      );
    }
    return [];
  }
}

function flattenDividerEntries(entries) {
  const flat = [];
  for (const entry of entries || []) {
    if (entry.kind === 'section') {
      flat.push({ startLine: entry.startLine, endLine: entry.endLine, kind: 'section', label: entry.label });
      for (const child of entry.children || []) {
        flat.push({ startLine: child.startLine, endLine: child.endLine, kind: 'subsection', label: child.label });
      }
    } else {
      flat.push({ startLine: entry.startLine, endLine: entry.endLine, kind: entry.kind || 'subsection', label: entry.label });
    }
  }
  return flat;
}

function findParentSectionForLine(entries, line) {
  for (const entry of entries || []) {
    if (entry.kind !== 'section') {
      continue;
    }
    if (line >= entry.startLine && line <= entry.endLine) {
      return entry;
    }
  }
  return null;
}

function orderLabelsAfterMove(currentOrder, sourceStarts, insertBeforeStart, appendToEnd) {
  const remaining = currentOrder.filter((item) => !sourceStarts.has(item.startLine));
  const moved = currentOrder.filter((item) => sourceStarts.has(item.startLine));
  if (appendToEnd) {
    return remaining.concat(moved);
  }
  const idx = remaining.findIndex((item) => item.startLine === insertBeforeStart);
  if (idx < 0) {
    return remaining.concat(moved);
  }
  return remaining.slice(0, idx).concat(moved, remaining.slice(idx));
}

function sameOrder(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i].startLine !== b[i].startLine) {
      return false;
    }
  }
  return true;
}

// Pure drop planner: same-level only, drop = insert before target.
// entries: dividerTreeEntries(document). sources: [{startLine,endLine,kind}].
// target: {startLine,endLine,kind} | undefined (root/empty = move to end).
// Returns {ok, reason, orderedSources, insertLine, moveKind} and never touches vscode.
function planDividerDrop(entries, rawSources, rawTarget) {
  const normalized = (rawSources || [])
    .filter((s) => s && Number.isInteger(s.startLine) && Number.isInteger(s.endLine))
    .map((s) => ({
      startLine: s.startLine,
      endLine: s.endLine,
      kind: s.kind === 'subsection' ? 'subsection' : 'section',
      name: typeof s.name === 'string' ? s.name : (typeof s.label === 'string' ? s.label : 'Section'),
    }));
  if (!normalized.length) {
    return { ok: false, reason: 'Nothing to move.' };
  }
  const orderedSources = dedupeDividerTargets(normalized);
  if (!orderedSources.length) {
    return { ok: false, reason: 'Nothing to move.' };
  }
  const kinds = new Set(orderedSources.map((s) => s.kind));
  if (kinds.size > 1) {
    return { ok: false, reason: 'Dragging sections and subsections together is not supported.' };
  }
  const moveKind = orderedSources[0].kind;
  const flat = flattenDividerEntries(entries);
  const byStart = new Map(flat.map((e) => [e.startLine, e]));
  for (const source of orderedSources) {
    const current = byStart.get(source.startLine);
    if (!current || current.kind !== source.kind || current.endLine !== source.endLine) {
      return { ok: false, reason: 'Dividers changed during drag, try again.' };
    }
  }
  const hasSections = (entries || []).some((e) => e.kind === 'section');

  if (moveKind === 'section') {
    const sections = (entries || []).filter((e) => e.kind === 'section');
    if (!sections.length) {
      return { ok: false, reason: 'No sections to reorder.' };
    }
    if (rawTarget && rawTarget.kind !== 'section') {
      return { ok: false, reason: 'Sections can only be reordered among sections.' };
    }
    let insertLine;
    let appendToEnd = false;
    let targetLabel = null;
    if (!rawTarget) {
      appendToEnd = true;
      insertLine = null; // resolved by caller to lineCount (append)
    } else {
      const target = byStart.get(rawTarget.startLine);
      if (!target || target.kind !== 'section') {
        return { ok: false, reason: 'Drop target is no longer there, try again.' };
      }
      for (const source of orderedSources) {
        if (rawTarget.startLine >= source.startLine && rawTarget.startLine <= source.endLine) {
          return { ok: false, noop: true, reason: 'Already there.' };
        }
      }
      insertLine = target.startLine;
      targetLabel = target.label;
    }
    const currentOrder = sections.map((s) => ({ startLine: s.startLine }));
    const sourceStarts = new Set(orderedSources.map((s) => s.startLine));
    const nextOrder = orderLabelsAfterMove(currentOrder, sourceStarts, insertLine, appendToEnd);
    if (sameOrder(currentOrder, nextOrder)) {
      return { ok: false, noop: true, reason: 'Already there.' };
    }
    return { ok: true, orderedSources, insertLine, appendToEnd, moveKind, targetLabel };
  }

  // moveKind === 'subsection'
  if (!hasSections) {
    const siblings = (entries || []).filter((e) => e.kind !== 'section');
    if (!siblings.length) {
      return { ok: false, reason: 'No subsections to reorder.' };
    }
    if (rawTarget && rawTarget.kind !== 'subsection') {
      return { ok: false, reason: 'Subsections can only be reordered among subsections.' };
    }
    let insertLine = null;
    let appendToEnd = false;
    let targetLabel = null;
    if (!rawTarget) {
      appendToEnd = true;
    } else {
      const target = byStart.get(rawTarget.startLine);
      if (!target || target.kind === 'section') {
        return { ok: false, reason: 'Drop target is no longer there, try again.' };
      }
      for (const source of orderedSources) {
        if (rawTarget.startLine >= source.startLine && rawTarget.startLine <= source.endLine) {
          return { ok: false, noop: true, reason: 'Already there.' };
        }
      }
      insertLine = target.startLine;
      targetLabel = target.label;
    }
    const currentOrder = siblings.map((s) => ({ startLine: s.startLine }));
    const sourceStarts = new Set(orderedSources.map((s) => s.startLine));
    if (sameOrder(currentOrder, orderLabelsAfterMove(currentOrder, sourceStarts, insertLine, appendToEnd))) {
      return { ok: false, noop: true, reason: 'Already there.' };
    }
    return { ok: true, orderedSources, insertLine, appendToEnd, moveKind, targetLabel };
  }

  const parentOf = (line) => findParentSectionForLine(entries, line);
  const sourceParents = orderedSources.map((s) => parentOf(s.startLine));
  if (sourceParents.some((p) => !p)) {
    return { ok: false, reason: 'Subsections can only be reordered within the same section.' };
  }
  const parentStart = sourceParents[0].startLine;
  if (!sourceParents.every((p) => p.startLine === parentStart)) {
    return { ok: false, reason: 'Subsections can only be reordered within the same section.' };
  }
  const parent = sourceParents[0];
  const siblings = parent.children || [];
  if (rawTarget) {
    if (rawTarget.kind !== 'subsection') {
      return { ok: false, reason: 'Drop onto a subsection to reorder it.' };
    }
    const targetParent = parentOf(rawTarget.startLine);
    if (!targetParent || targetParent.startLine !== parentStart) {
      return { ok: false, reason: 'Subsections can only be reordered within the same section.' };
    }
    const target = (siblings.find((c) => c.startLine === rawTarget.startLine)
      || byStart.get(rawTarget.startLine));
    if (!target) {
      return { ok: false, reason: 'Drop target is no longer there, try again.' };
    }
    for (const source of orderedSources) {
      if (rawTarget.startLine >= source.startLine && rawTarget.startLine <= source.endLine) {
        return { ok: false, noop: true, reason: 'Already there.' };
      }
    }
    const currentOrder = siblings.map((s) => ({ startLine: s.startLine }));
    const sourceStarts = new Set(orderedSources.map((s) => s.startLine));
    const nextOrder = orderLabelsAfterMove(currentOrder, sourceStarts, target.startLine, false);
    if (sameOrder(currentOrder, nextOrder)) {
      return { ok: false, noop: true, reason: 'Already there.' };
    }
    return { ok: true, orderedSources, insertLine: target.startLine, appendToEnd: false, moveKind, targetLabel: target.label, parent };
  }
  // Root drop with sections present: move to end of its own parent.
  const currentOrder = siblings.map((s) => ({ startLine: s.startLine }));
  const sourceStarts = new Set(orderedSources.map((s) => s.startLine));
  if (sameOrder(currentOrder, orderLabelsAfterMove(currentOrder, sourceStarts, null, true))) {
    return { ok: false, noop: true, reason: 'Already there.' };
  }
  return { ok: true, orderedSources, insertLine: parent.endLine + 1, appendToEnd: true, moveKind, targetLabel: null, parent };
}

// Pure line reorder used by drag-and-drop. Moves the exact source line ranges
// (including any trailing empty line) so a section dragged to the top keeps
// its trailing blank instead of leaving it pinned at EOF.
function reorderDividerLines(allLines, orderedSources, insertLine) {
  const total = allLines.length;
  const remaining = allLines.slice();
  const blocks = [];
  const desc = orderedSources.slice().sort((a, b) => b.startLine - a.startLine);
  for (const source of desc) {
    const len = Math.max(0, source.endLine - source.startLine + 1);
    const block = remaining.splice(source.startLine, len);
    blocks.unshift(block);
  }
  const flat = [];
  for (const block of blocks) {
    for (const line of block) {
      flat.push(line);
    }
  }
  const removedBefore = (line) => {
    let count = 0;
    for (const source of orderedSources) {
      const len = Math.max(0, source.endLine - source.startLine + 1);
      if (source.startLine < line) {
        // Sources never contain the insert line (checked by planner), so any
        // source starting before it ends before it as well.
        count += len;
      }
    }
    return count;
  };
  let adjusted;
  if (insertLine == null || insertLine >= total) {
    adjusted = remaining.length;
  } else {
    adjusted = insertLine - removedBefore(insertLine);
  }
  adjusted = Math.max(0, Math.min(adjusted, remaining.length));
  remaining.splice(adjusted, 0, ...flat);
  return { lines: remaining, insertIndex: adjusted };
}

function normalizeDragPayload(value) {
  const out = [];
  const push = (candidate) => {
    if (!candidate || !Number.isInteger(candidate.startLine) || !Number.isInteger(candidate.endLine)) {
      return;
    }
    out.push({
      startLine: candidate.startLine,
      endLine: candidate.endLine,
      kind: candidate.kind === 'subsection' ? 'subsection' : 'section',
      name: typeof candidate.name === 'string' ? candidate.name : (typeof candidate.label === 'string' ? candidate.label : 'Section'),
      documentUri: candidate.documentUri,
    });
  };
  if (Array.isArray(value)) {
    for (const item of value) {
      push(item);
    }
  } else {
    push(value);
  }
  return out;
}

function dragPayloadFromTreeItems(items) {
  return (items || []).filter(isDividerTreeItem).map((item) => ({
    startLine: item.dividerStartLine,
    endLine: item.dividerEndLine,
    kind: item.dividerKind === 'subsection' ? 'subsection' : 'section',
    name: typeof item.label === 'string' ? item.label : String(item.label || 'Section'),
    documentUri: item.dividerDocumentUri,
  }));
}

async function performDividerMove(editor, orderedSources, insertLine) {
  const document = editor.document;
  const total = document.lineCount;
  const allLines = [];
  for (let i = 0; i < total; i++) {
    allLines.push(document.lineAt(i).text);
  }
  const resolvedInsert = insertLine == null ? total : insertLine;
  const { lines: nextLines, insertIndex } = reorderDividerLines(allLines, orderedSources, resolvedInsert);
  const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  const nextText = nextLines.join(eol);
  const fullRange = new vscode.Range(
    new vscode.Position(0, 0),
    new vscode.Position(total - 1, document.lineAt(total - 1).text.length)
  );
  const applied = await editor.edit(
    (editBuilder) => { editBuilder.replace(fullRange, nextText); },
    { undoStopBefore: true, undoStopAfter: true }
  );
  return applied ? { insertIndex } : null;
}

class DividerDragAndDropController {
  constructor() {
    this.dragMimeTypes = [DIVIDER_DRAG_MIME];
    this.dropMimeTypes = [DIVIDER_DRAG_MIME];
  }

  async handleDrag(sources, dataTransfer) {
    const payload = dragPayloadFromTreeItems(sources || []);
    if (!payload.length || !dataTransfer || typeof dataTransfer.set !== 'function') {
      return;
    }
    dataTransfer.set(DIVIDER_DRAG_MIME, new vscode.DataTransferItem(payload));
  }

  async handleDrop(target, dataTransfer) {
    const raw = dataTransfer ? dataTransfer.get(DIVIDER_DRAG_MIME) : null;
    if (!raw) {
      return;
    }
    const payload = normalizeDragPayload(raw.value);
    if (!payload.length) {
      return;
    }
    const uriStrings = new Set(payload.map((p) => String(p.documentUri)));
    if (uriStrings.size > 1) {
      vscode.window.showInformationMessage('Drag dividers from one file at a time.');
      return;
    }
    if (target && isDividerTreeItem(target)) {
      const targetUri = String(target.dividerDocumentUri);
      if (!uriStrings.has(targetUri)) {
        vscode.window.showInformationMessage('Cannot drop dividers across files.');
        return;
      }
    }
    let editor;
    try {
      editor = await getEditorForDocumentUri(payload[0].documentUri);
    } catch (error) {
      vscode.window.showInformationMessage('Could not open the divider file for drop.');
      return;
    }
    const document = editor.document;
    const entries = dividerTreeEntries(document);
    const dropTarget = isDividerTreeItem(target)
      ? { startLine: target.dividerStartLine, endLine: target.dividerEndLine, kind: target.dividerKind }
      : undefined;
    const plan = planDividerDrop(entries, payload, dropTarget);
    if (!plan.ok) {
      if (plan.noop) {
        vscode.window.setStatusBarMessage(plan.reason || 'Already there.', 3000);
      } else {
        vscode.window.showInformationMessage(plan.reason || 'Cannot move dividers there.');
      }
      return;
    }
    const resolvedInsert = plan.appendToEnd && plan.insertLine == null ? document.lineCount : plan.insertLine;
    const result = await performDividerMove(editor, plan.orderedSources, resolvedInsert);
    if (!result) {
      return;
    }
    const first = plan.orderedSources[0];
    const titleOffset = first.kind === 'subsection' ? 0 : 1;
    const titleLine = Math.max(0, Math.min(result.insertIndex + titleOffset, editor.document.lineCount - 1));
    const position = new vscode.Position(titleLine, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    const movedLabel = first.name || 'divider';
    if (plan.targetLabel) {
      vscode.window.setStatusBarMessage(`Moved '${movedLabel}' before '${plan.targetLabel}'`, 3000);
    } else {
      vscode.window.setStatusBarMessage(
        plan.orderedSources.length === 1 ? `Moved '${movedLabel}' to the end` : `Moved ${plan.orderedSources.length} dividers to the end`,
        3000
      );
    }
  }
}

class LuaDividerFoldingProvider {
  provideFoldingRanges(document) {
    if (document.languageId !== 'lua') {
      return [];
    }
    const { separatorLength, allowCommentedSeparators, subheader } = getDividerConfig(document);
    const ranges = [];
    const push = (startLine, endLine) => {
      if (endLine > startLine) {
        const kind = vscode.FoldingRangeKind ? vscode.FoldingRangeKind.Region : undefined;
        ranges.push(new vscode.FoldingRange(startLine, endLine, kind));
      }
    };
    const mainHeaders = findDividerSections(document, separatorLength, allowCommentedSeparators);
    for (let index = 0; index < mainHeaders.length; index++) {
      const header = mainHeaders[index];
      const next = mainHeaders[index + 1];
      const endLine = next ? Math.max(header.endLine, next.startLine - 1) : document.lineCount - 1;
      push(header.startLine, endLine);
      const sectionBound = endLine + 1;
      const childMatches = collectChildMatches(document, header, endLine, subheader);
      for (let childIndex = 0; childIndex < childMatches.length; childIndex++) {
        const child = childMatches[childIndex];
        push(child.line, Math.max(child.line, childEndLine(childMatches, childIndex, sectionBound)));
      }
    }
    if (ranges.length === 0 && subheader) {
      const longStringMask = computeLongStringMask(document);
      const matches = [];
      for (let line = 0; line < document.lineCount; line++) {
        if (longStringMask[line]) {
          continue;
        }
        const match = subheader.exec(document.lineAt(line).text);
        if (match && match[1]) {
          matches.push({ line });
        }
      }
      for (let index = 0; index < matches.length; index++) {
        const current = matches[index];
        const following = matches[index + 1];
        push(current.line, Math.max(current.line, (following ? following.line : document.lineCount) - 1));
      }
    }
    return ranges;
  }
}

async function expandAllDividers(treeView, treeProvider) {
  const roots = await treeProvider.getChildren();
  for (const node of roots || []) {
    try {
      await treeView.reveal(node, { expand: 3, focus: false, select: false });
    } catch (error) {
      // Ignore missing elements (e.g. document changed mid-loop).
    }
  }
}

async function revealDivider(treeItem) {
  // Tree click: jump straight to the row (single click) or select the whole
  // section on double click. Palette invocation (no row): fuzzy jumper.
  if (isDividerTreeItem(treeItem) && typeof treeItem.dividerRevealLine === 'number') {
    const editor = await getEditorForDocumentUri(treeItem.dividerDocumentUri);
    const document = editor.document;
    const startLine = Math.max(0, Math.min(treeItem.dividerStartLine, document.lineCount - 1));
    const endLine = Math.max(startLine, Math.min(treeItem.dividerEndLine, document.lineCount - 1));
    const revealLine = Math.max(startLine, Math.min(treeItem.dividerRevealLine, endLine));

    // Single click goes to the title (like Outline). A second click on the
    // same row within the double-click window selects the whole section
    // (like Outline double-click).
    const key = `${treeItem.dividerDocumentUri.toString()}::${startLine}::${endLine}`;
    const now = Date.now();
    const isDoubleClick =
      key === lastRevealKey && now - lastRevealTime < DOUBLE_CLICK_MS;
    lastRevealKey = key;
    lastRevealTime = now;

    if (isDoubleClick) {
      const range = new vscode.Range(
        new vscode.Position(startLine, 0),
        new vscode.Position(endLine, document.lineAt(endLine).text.length)
      );
      editor.selection = new vscode.Selection(range.start, range.end);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      return;
    }

    const position = new vscode.Position(revealLine, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    return;
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'lua') {
    vscode.window.showInformationMessage('Open a Lua file to jump to a divider.');
    return;
  }
  const document = editor.document;
  const entries = dividerTreeEntries(document);
  if (!entries.length) {
    vscode.window.setStatusBarMessage('No divider sections found', 3000);
    return;
  }
  const items = [];
  for (const entry of entries) {
    if (entry.kind === 'section') {
      items.push({
        label: entry.label,
        description: formatLineRange(entry.startLine + 1, entry.endLine + 1),
        revealLine: entry.revealLine,
      });
      for (const child of entry.children || []) {
        items.push({
          label: child.label,
          description: formatLineRange(child.startLine + 1, child.endLine + 1),
          detail: entry.label,
          revealLine: child.revealLine,
        });
      }
    } else {
      items.push({
        label: entry.label,
        description: formatLineRange(entry.startLine + 1, entry.endLine + 1),
        revealLine: entry.revealLine,
      });
    }
  }
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Go to divider section',
    matchOnDescription: true,
    matchOnDetail: true,
    onDidSelectItem: (item) => {
      if (item && Number.isInteger(item.revealLine)) {
        const preview = new vscode.Position(
          Math.max(0, Math.min(item.revealLine, document.lineCount - 1)),
          0
        );
        editor.revealRange(
          new vscode.Range(preview, preview),
          vscode.TextEditorRevealType.InCenterIfOutsideViewport
        );
      }
    },
  });
  if (!picked || !Number.isInteger(picked.revealLine)) {
    return;
  }
  const position = new vscode.Position(
    Math.max(0, Math.min(picked.revealLine, editor.document.lineCount - 1)),
    0
  );
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

async function collapseAllDividers() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'lua') {
    vscode.window.setStatusBarMessage('Open a Lua file to collapse dividers.', 3000);
    return;
  }
  await vscode.commands.executeCommand('editor.foldAll');
}

let titleDecorationType = null;
let subheaderTitleDecorationType = null;
let separatorDecorationType = null;

function sanitizeColor(value) {
  const color = String(value == null ? '' : value).trim();
  return color || undefined;
}

function clampOpacity(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0.5;
  }
  return Math.max(0.1, Math.min(1, parsed));
}

function createTitleDecorationType(bold, color) {
  if (titleDecorationType) {
    titleDecorationType.dispose();
    titleDecorationType = null;
  }
  const options = {};
  if (bold) {
    options.fontWeight = 'bold';
  }
  const sanitized = sanitizeColor(color);
  if (sanitized) {
    options.color = sanitized;
  }
  if (!bold && !sanitized) {
    return null;
  }
  titleDecorationType = vscode.window.createTextEditorDecorationType(options);
  return titleDecorationType;
}

function createSubheaderTitleDecorationType(bold, color) {
  if (subheaderTitleDecorationType) {
    subheaderTitleDecorationType.dispose();
    subheaderTitleDecorationType = null;
  }
  const options = {};
  if (bold) {
    options.fontWeight = 'bold';
  }
  const sanitized = sanitizeColor(color);
  if (sanitized) {
    options.color = sanitized;
  }
  if (!bold && !sanitized) {
    return null;
  }
  subheaderTitleDecorationType = vscode.window.createTextEditorDecorationType(options);
  return subheaderTitleDecorationType;
}

function createSeparatorDecorationType(dim, opacity) {
  if (separatorDecorationType) {
    separatorDecorationType.dispose();
    separatorDecorationType = null;
  }
  if (!dim) {
    return null;
  }
  separatorDecorationType = vscode.window.createTextEditorDecorationType({
    opacity: String(clampOpacity(opacity)),
  });
  return separatorDecorationType;
}

function collectMainTitleRanges(document, separatorLength, allowCommentedSeparators) {
  const ranges = [];
  const mains = findDividerSections(document, separatorLength, allowCommentedSeparators);
  for (const header of mains) {
    ranges.push(document.lineAt(header.titleLine).range);
  }
  return ranges;
}

function collectSubheaderTitleRanges(document, subheader) {
  const ranges = [];
  if (!subheader) {
    return ranges;
  }
  const longStringMask = computeLongStringMask(document);
  for (let line = 0; line < document.lineCount; line++) {
    if (longStringMask[line]) {
      continue;
    }
    const match = subheader.exec(document.lineAt(line).text);
    if (match && match[1]) {
      ranges.push(document.lineAt(line).range);
    }
  }
  return ranges;
}

function collectTitleRanges(document, separatorLength, allowCommentedSeparators, subheader) {
  return collectMainTitleRanges(document, separatorLength, allowCommentedSeparators).concat(
    collectSubheaderTitleRanges(document, subheader)
  );
}

function collectSeparatorRanges(document, separatorLength, allowCommentedSeparators) {
  const ranges = [];
  const mains = findDividerSections(document, separatorLength, allowCommentedSeparators);
  for (const header of mains) {
    ranges.push(document.lineAt(header.startLine).range);
    ranges.push(document.lineAt(header.endLine).range);
  }
  return ranges;
}

function refreshTitleDecorations(editor) {
  if (!editor || editor.document.languageId !== 'lua') {
    return;
  }
  const document = editor.document;
  const config = vscode.workspace.getConfiguration('luaDividerOutline', document.uri);
  const enabled = config.get('decorations.enabled', true);
  if (!enabled) {
    // Disposing the decoration types already clears them.
    return;
  }
  const { separatorLength, allowCommentedSeparators, subheader } = getDividerConfig(document);
  if (titleDecorationType) {
    const ranges = collectMainTitleRanges(document, separatorLength, allowCommentedSeparators);
    editor.setDecorations(titleDecorationType, ranges);
  }
  if (subheaderTitleDecorationType) {
    const ranges = collectSubheaderTitleRanges(document, subheader);
    editor.setDecorations(subheaderTitleDecorationType, ranges);
  }
  if (separatorDecorationType) {
    const ranges = collectSeparatorRanges(document, separatorLength, allowCommentedSeparators);
    editor.setDecorations(separatorDecorationType, ranges);
  }
}

function refreshAllTitleDecorations() {
  const editors = vscode.window.visibleTextEditors || [];
  for (const editor of editors) {
    refreshTitleDecorations(editor);
  }
  const active = vscode.window.activeTextEditor;
  if (active && !editors.includes(active)) {
    refreshTitleDecorations(active);
  }
}

function syncTitleDecorationFromConfig(documentUri) {
  const config = vscode.workspace.getConfiguration('luaDividerOutline', documentUri);
  const enabled = config.get('decorations.enabled', true);
  if (!enabled) {
    if (titleDecorationType) {
      titleDecorationType.dispose();
      titleDecorationType = null;
    }
    if (subheaderTitleDecorationType) {
      subheaderTitleDecorationType.dispose();
      subheaderTitleDecorationType = null;
    }
    if (separatorDecorationType) {
      separatorDecorationType.dispose();
      separatorDecorationType = null;
    }
    return null;
  }
  const bold = config.get('decorations.titleBold', true);
  const color = config.get('decorations.titleColor', '#ffffff');
  createTitleDecorationType(bold, color);
  const subheaderBold = config.get('decorations.subheaderTitleBold', true);
  const subheaderColor = config.get('decorations.subheaderTitleColor', '#ffffff');
  createSubheaderTitleDecorationType(subheaderBold, subheaderColor);
  const dim = config.get('decorations.separatorDim', true);
  const opacity = clampOpacity(config.get('decorations.separatorOpacity', 0.5));
  createSeparatorDecorationType(dim, opacity);
  return { titleDecorationType, subheaderTitleDecorationType, separatorDecorationType };
}

function activate(context) {
  const provider = new LuaDividerOutlineProvider();
  const dividerTreeProvider = new DividerTreeProvider();

  syncTitleDecorationFromConfig();
  // Defer first paint so the active editor exists when VS Code starts up.
  if (typeof setImmediate !== 'undefined') {
    setImmediate(() => refreshAllTitleDecorations());
  }

  const dividerTreeView = vscode.window.createTreeView(DIVIDER_VIEW_ID, {
    treeDataProvider: dividerTreeProvider,
    dragAndDropController: new DividerDragAndDropController(),
    canSelectMany: true,
    showCollapseAll: true,
  });

  context.subscriptions.push(
    dividerTreeView,
    vscode.languages.registerDocumentSymbolProvider(
      { language: 'lua' },
      provider,
      { label: 'Lua Divider Outline' }
    ),
    vscode.languages.registerFoldingRangeProvider(
      { language: 'lua' },
      new LuaDividerFoldingProvider()
    ),
    vscode.commands.registerCommand(INSERT_DIVIDER_COMMAND, insertDividerSection),
    vscode.commands.registerCommand(INSERT_DIVIDER_SUBSECTION_COMMAND, insertDividerSubsection),
    vscode.commands.registerCommand(RENAME_DIVIDER_COMMAND, (...args) => renameDividerSection(...args)),
    vscode.commands.registerCommand(DUPLICATE_DIVIDER_COMMAND, (...args) => duplicateDividerSection(...args)),
    vscode.commands.registerCommand(MOVE_DIVIDER_UP_COMMAND, (...args) => moveDividerSection(-1, ...args)),
    vscode.commands.registerCommand(MOVE_DIVIDER_DOWN_COMMAND, (...args) => moveDividerSection(1, ...args)),
    vscode.commands.registerCommand(GO_TO_NEXT_DIVIDER_COMMAND, () => goToDividerSection(1)),
    vscode.commands.registerCommand(GO_TO_PREVIOUS_DIVIDER_COMMAND, () => goToDividerSection(-1)),
    vscode.commands.registerCommand(COPY_DIVIDER_COMMAND, (...args) => copyDividerSection(...args)),
    vscode.commands.registerCommand(CUT_DIVIDER_COMMAND, (...args) => cutDividerSection(...args)),
    vscode.commands.registerCommand(DELETE_DIVIDER_COMMAND, (...args) => deleteDividerSection(...args)),
    vscode.commands.registerCommand(SELECT_DIVIDER_COMMAND, (...args) => selectDividerSection(...args)),
    vscode.commands.registerCommand(REVEAL_DIVIDER_COMMAND, revealDivider),
    vscode.commands.registerCommand(REFRESH_DIVIDERS_COMMAND, () => dividerTreeProvider.refresh()),
    vscode.commands.registerCommand(EXPAND_ALL_DIVIDERS_COMMAND, () =>
      expandAllDividers(dividerTreeView, dividerTreeProvider)
    ),
    vscode.commands.registerCommand(COLLAPSE_ALL_DIVIDERS_COMMAND, () => collapseAllDividers()),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      refreshTitleDecorations(editor);
      dividerTreeProvider.refresh();
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      const active = vscode.window.activeTextEditor;
      if (active && event.document === active.document) {
        refreshTitleDecorations(active);
      } else {
        for (const editor of vscode.window.visibleTextEditors || []) {
          if (editor.document === event.document) {
            refreshTitleDecorations(editor);
          }
        }
      }
      if (event.document.languageId === 'lua') {
        dividerTreeProvider.refresh();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('luaDividerOutline')) {
        syncTitleDecorationFromConfig();
        refreshAllTitleDecorations();
        dividerTreeProvider.refresh();
      }
    }),
    { dispose: () => { if (titleDecorationType) { titleDecorationType.dispose(); titleDecorationType = null; } if (subheaderTitleDecorationType) { subheaderTitleDecorationType.dispose(); subheaderTitleDecorationType = null; } if (separatorDecorationType) { separatorDecorationType.dispose(); separatorDecorationType = null; } } }
  );

  refreshAllTitleDecorations();
}

function deactivate() { }

module.exports = {
  activate,
  deactivate,
  // Exported for tests; harmless in production.
  __test: {
    findDividerSections,
    buildSubheaderRegExp,
    collectChildMatches,
    childEndLine,
    computeLongStringMask,
    getLongBracketOpener,
    isLongBracketCloser,
    findEnclosingDivider,
    collectDividerTargets,
    deleteRangeOf,
    collectTitleRanges,
    collectMainTitleRanges,
    collectSubheaderTitleRanges,
    collectSeparatorRanges,
    sanitizeColor,
    clampOpacity,
    isDividerTreeItem,
    collectTreeItems,
    dedupeDividerTargets,
    dividerTreeEntries,
    DividerTreeItem,
    DividerTreeProvider,
    DividerDragAndDropController,
    DIVIDER_DRAG_MIME,
    DIVIDER_VIEW_ID,
    flattenDividerEntries,
    findParentSectionForLine,
    planDividerDrop,
    reorderDividerLines,
    normalizeDragPayload,
    dragPayloadFromTreeItems,
    performDividerMove,
    revealDivider,
    expandAllDividers,
    collapseAllDividers,
    LuaDividerFoldingProvider,
    insertDividerSection,
    insertDividerSubsection,
    buildDividerInsertions,
    buildSubheaderInsertions,
    clampInsertDashCount,
    trailingDashCountFor,
    sanitizeTitleWithFallback,
    renameDividerSection,
    renamedSectionTitleLine,
    renamedSubsectionLine,
    findSectionHeaderByStart,
    duplicateDividerSection,
    moveDividerSection,
    collectGoToStops,
    goToDividerSection,
    selectDividerSection,
    DOUBLE_CLICK_MS,
    _resetRevealState: () => {
      lastRevealKey = null;
      lastRevealTime = 0;
    },
  }
};
