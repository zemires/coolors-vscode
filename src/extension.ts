import * as vscode from 'vscode';

interface ColorMatch {
	start: number;
	end: number;
	hex: string; // 6-digit hex without '#'
}

// --- Color parsing -------------------------------------------------------

function hexToHex6(token: string): string | undefined {
	let h = token.slice(1); // strip '#'
	if (h.length === 3 || h.length === 4) {
		h = h.split('').map(c => c + c).join('');
	}
	if (h.length === 8) {
		h = h.slice(0, 6); // drop alpha
	}
	return h.length === 6 ? h.toLowerCase() : undefined;
}

function rgbToHex(token: string): string | undefined {
	const nums = token.match(/\d{1,3}/g);
	if (!nums || nums.length < 3) { return undefined; }
	const [r, g, b] = nums.slice(0, 3).map(Number);
	if ([r, g, b].some(v => v > 255)) { return undefined; }
	return [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function hslToHex(token: string): string | undefined {
	const m = token.match(/hsla?\(\s*(\d{1,3})(?:deg)?\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%/);
	if (!m) { return undefined; }
	const h = Number(m[1]) % 360;
	const s = Math.min(100, Number(m[2])) / 100;
	const l = Math.min(100, Number(m[3])) / 100;
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const mm = l - c / 2;
	let rgb: [number, number, number];
	if (h < 60) { rgb = [c, x, 0]; }
	else if (h < 120) { rgb = [x, c, 0]; }
	else if (h < 180) { rgb = [0, c, x]; }
	else if (h < 240) { rgb = [0, x, c]; }
	else if (h < 300) { rgb = [x, 0, c]; }
	else { rgb = [c, 0, x]; }
	return rgb.map(v => Math.round((v + mm) * 255).toString(16).padStart(2, '0')).join('');
}

const COLOR_PATTERNS: { re: RegExp; toHex: (token: string) => string | undefined }[] = [
	{ re: /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g, toHex: hexToHex6 },
	{ re: /rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)/g, toHex: rgbToHex },
	{ re: /hsla?\(\s*\d{1,3}(?:deg)?\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)/g, toHex: hslToHex },
];

const HEX6_RE = /^[0-9a-f]{6}$/;

function findColorsInLine(text: string): ColorMatch[] {
	const matches: ColorMatch[] = [];
	for (const { re, toHex } of COLOR_PATTERNS) {
		re.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(text)) !== null) {
			const hex = toHex(m[0]);
			if (hex) {
				matches.push({ start: m.index, end: m.index + m[0].length, hex });
			}
		}
	}
	return matches;
}

function colorMatchAtCursor(editor: vscode.TextEditor): (ColorMatch & { line: number; token: string }) | undefined {
	const pos = editor.selection.active;
	const lineText = editor.document.lineAt(pos.line).text;
	const match = findColorsInLine(lineText).find(c => pos.character >= c.start && pos.character <= c.end);
	return match ? { ...match, line: pos.line, token: lineText.slice(match.start, match.end) } : undefined;
}

function colorAtCursor(editor: vscode.TextEditor): string | undefined {
	return colorMatchAtCursor(editor)?.hex;
}

// --- Clipboard watcher -----------------------------------------------------
// coolors.co copies the hex value to the clipboard when a color is clicked.
// While a coolors panel is open we poll the clipboard; when a new hex value
// shows up, we insert it (with leading '#') at the cursor of the source editor.

interface PanelEntry {
	panel: vscode.WebviewPanel;
	sourceEditor: vscode.TextEditor | undefined;
	hex: string;
}

const openPanels: PanelEntry[] = [];
let clipboardTimer: ReturnType<typeof setInterval> | undefined;
let lastClipboard: string | undefined;

function stopClipboardWatcher() {
	if (clipboardTimer) {
		clearInterval(clipboardTimer);
		clipboardTimer = undefined;
	}
}

function startClipboardWatcher() {
	if (clipboardTimer) { return; }
	vscode.env.clipboard.readText().then(t => { lastClipboard = t; }, () => { /* ignore */ });

	clipboardTimer = setInterval(async () => {
		// ignore clipboard changes made while VSCode is not focused
		// (e.g. hex values copied in other applications)
		if (!vscode.window.state.focused) {
			lastClipboard = undefined;
			return;
		}
		let text: string;
		try {
			text = (await vscode.env.clipboard.readText()).trim();
		} catch {
			return;
		}
		if (lastClipboard === undefined) {
			// re-baseline after losing focus: don't treat this value as new
			lastClipboard = text;
			return;
		}
		if (text === lastClipboard) { return; }
		lastClipboard = text;

		const m = text.match(/^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/);
		if (!m) { return; }
		const hex = hexToHex6(`#${m[1]}`);
		if (!hex) { return; }
		const hexValue = `#${hex}`;

		// normalize clipboard to hex format including '#'
		if (text !== hexValue) {
			await vscode.env.clipboard.writeText(hexValue);
			lastClipboard = hexValue;
		}

		// only the focused coolors panel may insert; fall back to the
		// sidebar view if it is visible and no panel has focus
		const activeEntry = openPanels.find(e => e.panel.active);
		let sourceEditor: vscode.TextEditor | undefined;
		if (activeEntry) {
			sourceEditor = activeEntry.sourceEditor;
		} else if (sidebarProvider.isVisible()) {
			sourceEditor = sidebarProvider.sourceEditor;
		} else {
			return;
		}

		const editor = sourceEditor && vscode.window.visibleTextEditors.includes(sourceEditor)
			? sourceEditor
			: vscode.window.activeTextEditor;
		if (!editor) { return; }

		// if the cursor is on an existing hex color, replace it; otherwise insert
		const existing = colorMatchAtCursor(editor);
		if (existing && existing.token.startsWith('#')) {
			const range = new vscode.Range(existing.line, existing.start, existing.line, existing.end);
			await editor.edit(edit => edit.replace(range, hexValue));
		} else {
			await editor.edit(edit => edit.insert(editor.selection.active, hexValue));
		}
	}, 500);
}

function trackPanel(panel: vscode.WebviewPanel, sourceEditor: vscode.TextEditor | undefined, hex: string) {
	openPanels.push({ panel, sourceEditor, hex });
	startClipboardWatcher();

	panel.onDidDispose(() => {
		const idx = openPanels.findIndex(e => e.panel === panel);
		if (idx !== -1) { openPanels.splice(idx, 1); }
		if (openPanels.length === 0 && !sidebarProvider.isVisible()) {
			stopClipboardWatcher();
		}
	});
}

// --- Webview -------------------------------------------------------------

function getWebviewHtml(hex: string): string {
	// hex is validated 6-digit lowercase hex, safe to interpolate
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src https://coolors.co; style-src 'unsafe-inline';">
<style>html,body,iframe{margin:0;padding:0;width:100%;height:100%;border:none;overflow:hidden;}</style>
</head>
<body>
<iframe src="https://coolors.co/${hex}" allowfullscreen
	sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"></iframe>
</body>
</html>`;
}

// --- Sidebar view ----------------------------------------------------------
// Single webview view showing only the latest color. Contributed to the
// activity bar; the user can drag it into the secondary side bar — VS Code
// remembers that placement, and focusing the view will then open it there.

class CoolorsViewProvider implements vscode.WebviewViewProvider {
	static readonly viewId = 'coolors.colorView';

	private view: vscode.WebviewView | undefined;
	private pendingHex: string | undefined;
	sourceEditor: vscode.TextEditor | undefined;

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		view.webview.options = { enableScripts: true };
		view.webview.html = this.pendingHex
			? getWebviewHtml(this.pendingHex)
			: '<p style="padding:8px;">Use “Explain in coolors.co” on a color to show it here.</p>';
		this.pendingHex = undefined;
		view.onDidChangeVisibility(() => {
			if (view.visible) {
				startClipboardWatcher();
			} else if (openPanels.length === 0) {
				stopClipboardWatcher();
			}
		});
		view.onDidDispose(() => {
			this.view = undefined;
			if (openPanels.length === 0) { stopClipboardWatcher(); }
		});
	}

	isVisible(): boolean {
		return this.view?.visible === true;
	}

	async showColor(hex: string): Promise<void> {
		this.sourceEditor = vscode.window.activeTextEditor;
		if (this.view) {
			this.view.webview.html = getWebviewHtml(hex);
			this.view.show(true);
		} else {
			// view not resolved yet: focusing it triggers resolveWebviewView
			this.pendingHex = hex;
			await vscode.commands.executeCommand(`${CoolorsViewProvider.viewId}.focus`);
		}
		startClipboardWatcher();
	}
}

const sidebarProvider = new CoolorsViewProvider();

function openCoolors(hex: string) {
	const location = vscode.workspace.getConfiguration('coolors').get<string>('openLocation', 'sidebar');
	if (location === 'sidebar') {
		void sidebarProvider.showColor(hex);
		return;
	}

	// reuse an existing panel for the same color instead of opening a duplicate
	const existing = openPanels.find(e => e.panel.title === `coolors · #${hex}`);
	if (existing) {
		existing.panel.reveal(undefined, true);
		return;
	}

	const sourceEditor = vscode.window.activeTextEditor;
	const panel = vscode.window.createWebviewPanel(
		'coolors',
		`coolors · #${hex}`,
		{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
		{ enableScripts: true, retainContextWhenHidden: true }
	);
	trackPanel(panel, sourceEditor, hex);
	panel.webview.html = getWebviewHtml(hex);
}

// --- Document links (Ctrl+hover underline, Ctrl+click opens) --------------

class ColorLinkProvider implements vscode.DocumentLinkProvider {
	provideDocumentLinks(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.DocumentLink[] {
		const links: vscode.DocumentLink[] = [];
		const maxLines = Math.min(document.lineCount, 10000);
		for (let i = 0; i < maxLines; i++) {
			if (token.isCancellationRequested) { return []; }
			for (const c of findColorsInLine(document.lineAt(i).text)) {
				const range = new vscode.Range(i, c.start, i, c.end);
				const target = vscode.Uri.parse(
					`command:coolors.explainInCoolors?${encodeURIComponent(JSON.stringify([c.hex]))}`
				);
				const link = new vscode.DocumentLink(range, target);
				link.tooltip = 'Explain in coolors.co';
				links.push(link);
			}
		}
		return links;
	}
}

// --- Context key for context menu visibility -------------------------------

let lastCursorOnColor: boolean | undefined;

function updateCursorContext() {
	const editor = vscode.window.activeTextEditor;
	const onColor = editor ? colorAtCursor(editor) !== undefined : false;
	if (onColor !== lastCursorOnColor) {
		lastCursorOnColor = onColor;
		vscode.commands.executeCommand('setContext', 'coolors.cursorOnColor', onColor);
	}
}

// --- Activation ------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('coolors.explainInCoolors', (hexArg?: unknown) => {
			let hex: string | undefined;
			if (typeof hexArg === 'string') {
				// command URIs can be invoked with arbitrary arguments — validate strictly
				hex = HEX6_RE.test(hexArg) ? hexArg : undefined;
			} else {
				const editor = vscode.window.activeTextEditor;
				if (!editor) {
					vscode.window.showWarningMessage('No active editor.');
					return;
				}
				hex = colorAtCursor(editor);
			}
			if (!hex) {
				vscode.window.showWarningMessage('No color found under cursor.');
				return;
			}
			openCoolors(hex);
		}),
		vscode.commands.registerCommand('coolors.openInBrowser', () => {
			// prefer the focused/visible coolors panel; fall back to color under cursor
			const entry = openPanels.find(e => e.panel.active) ?? openPanels.find(e => e.panel.visible);
			let hex = entry?.hex;
			if (!hex) {
				const editor = vscode.window.activeTextEditor;
				hex = editor ? colorAtCursor(editor) : undefined;
			}
			if (!hex) {
				vscode.window.showWarningMessage('No coolors panel open and no color under cursor.');
				return;
			}
			vscode.env.openExternal(vscode.Uri.parse(`https://coolors.co/${hex}`));
		}),
		vscode.window.registerWebviewViewProvider(CoolorsViewProvider.viewId, sidebarProvider, {
			webviewOptions: { retainContextWhenHidden: true }
		}),
		vscode.languages.registerDocumentLinkProvider({ scheme: '*' }, new ColorLinkProvider()),
		vscode.window.onDidChangeTextEditorSelection(e => {
			if (e.textEditor === vscode.window.activeTextEditor) {
				updateCursorContext();
			}
		}),
		vscode.window.onDidChangeActiveTextEditor(updateCursorContext)
	);
	updateCursorContext();
}

export function deactivate() {
	stopClipboardWatcher();
}
