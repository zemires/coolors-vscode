# Coolors for VS Code

Explore and explain colors from your code on [coolors.co](https://coolors.co) — without leaving VS Code.

## Features

- **Ctrl+Click any color** — hold <kbd>Ctrl</kbd> over a color value to underline it like a link, then click to open the coolors.co page for that color.
- **Context menu** — right-click a color and choose **Explain in coolors.co**. The menu entry only appears when the cursor is actually on a color.
- **Command palette** — run **Explain in coolors.co** with the cursor on a color, or **coolors: Open in Browser** to view the page in your external browser (e.g., for signing in to coolors.co).
- **Pick colors back into your code** — click a color swatch on the coolors.co page and it is inserted at your cursor as a hex value (e.g. `#ffee22`). If the cursor is already on a hex color, that color is replaced in place.
- **Sidebar or editor tab** — show the page in a compact side bar view (default) or as a full editor tab beside your code.

### Supported color formats

| Format | Examples |
|---|---|
| Hex | `#fe2`, `#ffee22`, `#ffee22cc` (alpha is ignored) |
| RGB | `rgb(255, 238, 34)`, `rgba(255, 238, 34, 0.5)` |
| HSL | `hsl(48, 100%, 57%)`, `hsla(48, 100%, 57%, 0.5)` |

All formats work in any file type.

## Settings

| Setting | Default | Description |
|---|---|---|
| `coolors.openLocation` | `sidebar` | Where to open the coolors.co page: `sidebar` shows a single view with the latest color; `editorTab` opens each color as a tab beside the editor. |

> **Tip:** The coolors view first appears in the activity bar. Drag it into the
> **secondary side bar** once — VS Code remembers the placement, and from then
> on colors open there automatically.

## Known limitations

- Signing in to coolors.co (Google/Apple) does not work inside the embedded view — OAuth providers block embedded frames. Use **coolors: Open in Browser** for the full signed-in experience.
- Inserting a clicked color relies on coolors.co copying the value to the clipboard; the insertion targets the editor the page was opened from.

## Development

```bash
git clone https://github.com/zemires/coolors-vscode.git
cd coolors-vscode
npm install
npm run compile   # or: npm run watch
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host with the extension loaded.

| Script | Purpose |
|---|---|
| `npm run compile` | Type-check and compile to `out/` |
| `npm run watch` | Compile on file change |
| `npm run lint` | Run ESLint |

## License

[MIT](LICENSE)
