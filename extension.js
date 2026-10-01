const vscode = require('vscode');

const MAIN_KIND = vscode.SymbolKind.Namespace;
const SUBHEADER_KIND = vscode.SymbolKind.Namespace;

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

    const mainSeparator = new RegExp(
      `^\\s*-{${separatorLength}}\\s*$`
    );

    const commentedMainSeparator = allowCommentedSeparators
      ? new RegExp(`^\\s*--\\s*-{${separatorLength}}\\s*$`)
      : null;

    // Example:
    // -- ------------------------------ Example text ------------------------------
    const subheader = subheadersEnabled
      ? new RegExp(
          `^\\s*--\\s*-{${subMin},${subMax}}\\s+(.+?)\\s+-{${subMin},${subMax}}\\s*$`
        )
      : null;

    const symbols = [];
    const mainHeaders = [];

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
      if (mainHeaders.length && i <= mainHeaders[mainHeaders.length - 1].endLine) {
        continue;
      }

      mainHeaders.push({
        startLine: i,
        endLine: i + 2,
        titleLine: i + 1,
        name: titleMatch[1]
      });
      i += 2;
    }

    // Main headers become top-level symbols. Their ranges extend to the next
    // main header, allowing nested subheaders and ordinary LuaLS symbols to sit
    // conceptually inside the section in the Outline.
    for (let index = 0; index < mainHeaders.length; index++) {
      const header = mainHeaders[index];
      const next = mainHeaders[index + 1];
      const endLine = next ? Math.max(header.endLine, next.startLine - 1) : document.lineCount - 1;

      const childSymbols = [];
      if (subheader) {
        for (let line = header.endLine + 1; line <= endLine; line++) {
          const match = subheader.exec(document.lineAt(line).text);
          if (!match || !match[1]) {
            continue;
          }

          const lineRange = document.lineAt(line).range;
          childSymbols.push(new vscode.DocumentSymbol(
            match[1].trim(),
            'divider subsection',
            SUBHEADER_KIND,
            lineRange,
            lineRange
          ));
        }
      }

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
        'divider section',
        MAIN_KIND,
        range,
        selectionRange
      ));

      // Nested subheaders are attached to their main divider section.
      symbols[symbols.length - 1].children = childSymbols;
    }

    // Files containing only subheaders still get useful Outline entries.
    if (symbols.length === 0 && subheader) {
      for (let line = 0; line < document.lineCount; line++) {
        const match = subheader.exec(document.lineAt(line).text);
        if (!match || !match[1]) {
          continue;
        }

        const lineRange = document.lineAt(line).range;
        symbols.push(new vscode.DocumentSymbol(
          match[1].trim(),
          'divider subsection',
          SUBHEADER_KIND,
          lineRange,
          lineRange
        ));
      }
    }

    return symbols;
  }
}

function activate(context) {
  const provider = new LuaDividerOutlineProvider();

  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      { language: 'lua' },
      provider,
      { label: 'Lua Divider Outline' }
    )
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
