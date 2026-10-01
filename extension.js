const vscode = require('vscode');

const MAIN_KIND = vscode.SymbolKind.Namespace;
const SUBHEADER_KIND = vscode.SymbolKind.Namespace;

const INSERT_DIVIDER_COMMAND = 'luaDividerOutline.insertDividerSection';
const GO_TO_NEXT_DIVIDER_COMMAND = 'luaDividerOutline.goToNextDivider';
const GO_TO_PREVIOUS_DIVIDER_COMMAND = 'luaDividerOutline.goToPreviousDivider';
const COPY_DIVIDER_COMMAND = 'luaDividerOutline.copyDividerSection';
const CUT_DIVIDER_COMMAND = 'luaDividerOutline.cutDividerSection';
const DELETE_DIVIDER_COMMAND = 'luaDividerOutline.deleteDividerSection';
const SELECT_DIVIDER_COMMAND = 'luaDividerOutline.selectDividerSection';
const REVEAL_DIVIDER_COMMAND = 'luaDividerOutline.revealDivider';
const REFRESH_DIVIDERS_COMMAND = 'luaDividerOutline.refreshDividers';
const EXPAND_ALL_DIVIDERS_COMMAND = 'luaDividerOutline.expandAllDividers';
const DIVIDER_VIEW_ID = 'luaDividerOutlineView';
const DEFAULT_SECTION_TITLE = 'Section';
const DOUBLE_CLICK_MS = 500;
let lastRevealKey = null;
let lastRevealTime = 0;

function findDividerSections(document, separatorLength, allowCommentedSeparators) {
  const mainSeparator = new RegExp(
    `^\\s*-{${separatorLength}}\\s*$`
  );

  const commentedMainSeparator = allowCommentedSeparators
    ? new RegExp(`^\\s*--\\s*-{${separatorLength}}\\s*$`)
    : null;

  const headers = [];

  for (let i = 0; i < document.lineCount - 2; i++) {
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
  return new RegExp(
    `^\\s*--\\s*-{${subMin},${subMax}}\\s+(.+?)\\s+-{${subMin},${subMax}}\\s*$`
  );
}

function getDividerConfig(document) {
  const config = vscode.workspace.getConfiguration('luaDividerOutline', document.uri);
  const separatorLength = config.get('separatorLength', 70);
  const allowCommentedSeparators = config.get('allowCommentedSeparators', true);
  const subheadersEnabled = config.get('subheaders.enabled', true);
  const subMin = config.get('subheaders.minimumDashLength', 3);
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
  for (let line = header.endLine + 1; line <= endLine; line++) {
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
  for (let scan = 0; scan < document.lineCount; scan++) {
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
    const subMin = config.get('subheaders.minimumDashLength', 3);
    const subMax = config.get('subheaders.maximumDashLength', 200);
    const showHintText = config.get('showHintText', false);
    const showLineNumbers = config.get('showLineNumbers', true);

    // Example:
    // -- ------------------------------ Example text ------------------------------
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
      for (let line = 0; line < document.lineCount; line++) {
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

function goToDividerSection(direction) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'lua') {
    return;
  }

  const document = editor.document;
  const config = vscode.workspace.getConfiguration('luaDividerOutline', document.uri);
  const sections = findDividerSections(
    document,
    config.get('separatorLength', 70),
    config.get('allowCommentedSeparators', true)
  );

  if (!sections.length) {
    vscode.window.setStatusBarMessage('No divider sections found', 3000);
    return;
  }

  const line = editor.selection.active.line;
  let target = null;

  if (direction > 0) {
    target = sections.find((section) => section.startLine > line) || sections[0];
  } else {
    for (let index = sections.length - 1; index >= 0; index--) {
      if (sections[index].endLine < line) {
        target = sections[index];
        break;
      }
    }
    target = target || sections[sections.length - 1];
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
    for (let line = 0; line < document.lineCount; line++) {
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

async function expandAllDividers(treeView, treeProvider) {
  const roots = await treeProvider.getChildren();
  for (const node of roots || []) {
    try {
      await treeView.reveal(node, { expand: true, focus: false, select: false });
    } catch (error) {
      // Ignore missing elements (e.g. document changed mid-loop).
    }
  }
}

async function revealDivider(treeItem) {
  if (!isDividerTreeItem(treeItem) || typeof treeItem.dividerRevealLine !== 'number') {
    return;
  }
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
}

let titleDecorationType = null;
let separatorDecorationType = null;

function sanitizeColor(value) {
  const color = String(value == null ? '' : value).trim();
  return color || undefined;
}

function clampOpacity(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0.65;
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

function collectTitleRanges(document, separatorLength, allowCommentedSeparators, subheader) {
  const ranges = [];
  const mains = findDividerSections(document, separatorLength, allowCommentedSeparators);
  for (const header of mains) {
    ranges.push(document.lineAt(header.titleLine).range);
  }
  if (subheader) {
    for (let line = 0; line < document.lineCount; line++) {
      const match = subheader.exec(document.lineAt(line).text);
      if (match && match[1]) {
        ranges.push(document.lineAt(line).range);
      }
    }
  }
  return ranges;
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
    const ranges = collectTitleRanges(document, separatorLength, allowCommentedSeparators, subheader);
    editor.setDecorations(titleDecorationType, ranges);
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
    if (separatorDecorationType) {
      separatorDecorationType.dispose();
      separatorDecorationType = null;
    }
    return null;
  }
  const bold = config.get('decorations.titleBold', true);
  const color = config.get('decorations.titleColor', '#ffffff');
  createTitleDecorationType(bold, color);
  const dim = config.get('decorations.separatorDim', true);
  const opacity = clampOpacity(config.get('decorations.separatorOpacity', 0.65));
  createSeparatorDecorationType(dim, opacity);
  return { titleDecorationType, separatorDecorationType };
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
    vscode.commands.registerCommand(INSERT_DIVIDER_COMMAND, insertDividerSection),
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
    { dispose: () => { if (titleDecorationType) { titleDecorationType.dispose(); titleDecorationType = null; } if (separatorDecorationType) { separatorDecorationType.dispose(); separatorDecorationType = null; } } }
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
    findEnclosingDivider,
    collectDividerTargets,
    deleteRangeOf,
    collectTitleRanges,
    collectSeparatorRanges,
    sanitizeColor,
    clampOpacity,
    isDividerTreeItem,
    collectTreeItems,
    dedupeDividerTargets,
    dividerTreeEntries,
    DividerTreeItem,
    DividerTreeProvider,
    revealDivider,
    expandAllDividers,
    selectDividerSection,
    DOUBLE_CLICK_MS,
    _resetRevealState: () => {
      lastRevealKey = null;
      lastRevealTime = 0;
    },
  }
};
