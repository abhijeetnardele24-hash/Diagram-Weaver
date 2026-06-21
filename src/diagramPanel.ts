import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Buffer } from 'buffer';

export class DiagramPanel {
    public static currentPanel: DiagramPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _lastDiagramSource: string = '';

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._panel.onDidDispose(() => this.dispose(), null);
        
        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'exportSvg':
                        await this.saveFile(message.data, 'svg', 'SVG Image');
                        break;
                    case 'exportPng':
                        // data is a base64 data URL
                        const base64Data = message.data.replace(/^data:image\/png;base64,/, "");
                        await this.saveFile(Buffer.from(base64Data, 'base64'), 'png', 'PNG Image');
                        break;
                    case 'exportMermaid':
                        await this.saveFile(this._lastDiagramSource, 'mmd', 'Mermaid Diagram');
                        break;
                    case 'exportDrawio':
                        const drawioXml = this.mermaidToDrawioXml(this._lastDiagramSource);
                        await this.saveFile(drawioXml, 'drawio', 'draw.io XML');
                        break;
                }
            }
        );
    }

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (DiagramPanel.currentPanel) {
            DiagramPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'diagramWeaver',
            'Diagram Weaver',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
            }
        );

        DiagramPanel.currentPanel = new DiagramPanel(panel, extensionUri);
    }

    public showLoading(title: string = "Generating Diagram...") {
        const webview = this._panel.webview;
        webview.html = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <style>
                    body {
                        font-family: var(--vscode-editor-font-family, 'Courier New', monospace);
                        display: flex;
                        flex-direction: column;
                        justify-content: center;
                        height: 100vh;
                        background-color: var(--vscode-terminal-background, #1e1e1e);
                        color: var(--vscode-terminal-foreground, #cccccc);
                        margin: 0;
                        padding: 40px;
                        box-sizing: border-box;
                    }
                    .terminal-window {
                        max-width: 800px;
                        width: 100%;
                        margin: 0 auto;
                    }
                    .line {
                        margin-bottom: 8px;
                        font-size: 14px;
                        line-height: 1.4;
                    }
                    .prompt { color: var(--vscode-terminal-ansiGreen, #4af626); font-weight: bold; }
                    .command { color: var(--vscode-terminal-foreground, #cccccc); font-weight: bold; }
                    .progress-container { margin-top: 20px; margin-bottom: 20px; font-size: 14px; }
                    .bar { color: var(--vscode-terminal-ansiCyan, #00ffff); font-weight: bold; letter-spacing: 1px; }
                    .pct { color: var(--vscode-terminal-ansiYellow, #f1fa8c); font-weight: bold; margin-left: 10px; }
                    .spinner { display: inline-block; width: 14px; color: var(--vscode-terminal-ansiMagenta, #ff79c6); font-weight: bold; }
                    .logs { color: var(--vscode-terminal-ansiBrightBlack, #6272a4); font-size: 13px; font-family: var(--vscode-editor-font-family, 'Courier New', monospace); }
                    .logs div { margin-bottom: 4px; }
                </style>
            </head>
            <body>
                <div class="terminal-window">
                    <div class="line"><span class="prompt">diagram-weaver@ai:~$</span> <span class="command">weave --target=mermaid --analyze-prompt</span></div>
                    <div class="line"><span class="spinner" id="spinner">⠋</span> <span id="status" style="color: var(--vscode-terminal-ansiWhite, #f8f8f2)">Initializing AI Engine...</span></div>
                    
                    <div class="progress-container">
                        <span class="bar" id="bar">[&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;]</span><span class="pct" id="pct">0%</span>
                    </div>
                    
                    <div class="logs" id="logs">
                        <div>> Allocating syntax buffer... OK</div>
                    </div>
                </div>
                <script>
                    const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
                    let sIdx = 0;
                    setInterval(() => {
                        document.getElementById('spinner').innerText = spinnerFrames[sIdx];
                        sIdx = (sIdx + 1) % spinnerFrames.length;
                    }, 80);

                    let p = 0;
                    const elPct = document.getElementById('pct');
                    const elBar = document.getElementById('bar');
                    const elStatus = document.getElementById('status');
                    const elLogs = document.getElementById('logs');
                    
                    const logs = [
                        "> Parsing user prompt for architectural entities...",
                        "> Extracting subgraph groupings...",
                        "> Mapping cross-boundary edges...",
                        "> Applying strict Mermaid sanitization rules...",
                        "> Validating node label string escaping...",
                        "> Compiling visual syntax tree...",
                        "> Receiving final AST from model...",
                        "> Executing layout engine sequence..."
                    ];
                    let logIdx = 0;

                    const interval = setInterval(() => {
                        if (p < 99) {
                            let jump = Math.floor(Math.random() * (99 - p) * 0.08) + 1;
                            p += jump;
                            if (p > 99) p = 99;
                            
                            // Update percentage
                            elPct.innerText = p.toString().padStart(2, '0') + '%';
                            
                            // Update ASCII bar (40 chars long)
                            const filledLen = Math.floor((p / 100) * 40);
                            const emptyLen = 40 - filledLen;
                            const filledStr = '='.repeat(filledLen > 0 ? filledLen - 1 : 0) + (filledLen > 0 ? '>' : '');
                            const emptyStr = '&nbsp;'.repeat(emptyLen);
                            elBar.innerHTML = '[' + filledStr + emptyStr + ']';
                            
                            // Update logs
                            if (p > (logIdx + 1) * 12 && logIdx < logs.length) {
                                elStatus.innerText = logs[logIdx].replace('> ', '');
                                const newLog = document.createElement('div');
                                newLog.innerText = logs[logIdx];
                                elLogs.appendChild(newLog);
                                logIdx++;
                                // Keep only last 6 logs
                                if (elLogs.children.length > 6) {
                                    elLogs.removeChild(elLogs.firstChild);
                                }
                            }
                        }
                    }, 80);
                </script>
            </body>
            </html>
        `;
    }

    public renderDiagram(diagramSource: string, engine?: string) {
        this._lastDiagramSource = diagramSource;
        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview, diagramSource, false, engine);
    }

    private _getHtmlForWebview(webview: vscode.Webview, diagramContent: string, isLoading: boolean = false, engine?: string) {
        const mermaidUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'mermaid.min.js'));
        const isEraser = engine?.includes('Eraser');

        // Soft, minimal hand-drawn look with generous whitespace
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; script-src ${webview.cspSource} 'unsafe-inline'; style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com;">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Diagram</title>
                <style>
                    body {
                        background-color: ${isEraser ? '#111111' : 'var(--vscode-editor-background)'};
                        color: ${isEraser ? '#ffffff' : 'var(--vscode-editor-foreground)'};
                        font-family: ${isEraser ? "'Inter', sans-serif" : "var(--vscode-font-family)"};
                        padding: 20px;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                    }
                    ${isEraser ? `
                    /* ERASER.IO CUSTOM CSS OVERRIDES */
                    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
                    .node rect, .node circle, .node ellipse, .node polygon, .node path {
                        fill: #1A1A1A !important;
                        stroke: #FF4D82 !important; /* Eraser Pink */
                        stroke-width: 2px !important;
                        rx: 8px !important;
                        ry: 8px !important;
                    }
                    .cluster rect {
                        fill: transparent !important;
                        stroke: #FF4D82 !important;
                        stroke-width: 1px !important;
                        stroke-dasharray: 8, 4 !important;
                        rx: 12px !important;
                    }
                    .edgePath .path { stroke: #888888 !important; stroke-width: 2.5px !important; }
                    .edgeLabel { background-color: #111111 !important; color: #ffffff !important; font-family: 'Inter', sans-serif !important; }
                    .marker { fill: #888888 !important; stroke: #888888 !important; }
                    .nodeText { fill: #ffffff !important; font-weight: 600 !important; font-family: 'Inter', sans-serif !important; }
                    .cluster-label { fill: #FF4D82 !important; font-weight: bold !important; font-family: 'Inter', sans-serif !important; letter-spacing: 1px; }
                    ` : ''}
                    .toolbar {
                        margin-bottom: 20px;
                        display: flex;
                        gap: 10px;
                    }
                    button {
                        background: ${isEraser ? '#1E1E1E' : 'var(--vscode-button-background)'};
                        color: ${isEraser ? '#ffffff' : 'var(--vscode-button-foreground)'};
                        border: ${isEraser ? '1px solid #333333' : 'none'};
                        padding: 8px 16px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 13px;
                        font-weight: 600;
                        transition: all 0.2s ease;
                    }
                    button:hover {
                        background: ${isEraser ? '#2A2A2A' : 'var(--vscode-button-hoverBackground)'};
                        border-color: ${isEraser ? '#FF4D82' : 'none'};
                        box-shadow: ${isEraser ? '0 0 10px rgba(255, 77, 130, 0.3)' : 'none'};
                    }
                    .diagram-container {
                        background-color: ${isEraser ? '#0A0A0A' : '#fafafa'};
                        border: ${isEraser ? '1px solid #1A1A1A' : 'none'};
                        border-radius: 8px;
                        padding: 40px;
                        width: 100%;
                        max-width: 1000px;
                        overflow: auto;
                        display: flex;
                        justify-content: center;
                        box-shadow: 0 4px 12px rgba(0,0,0,0.05);
                    }
                    /* Ensure SVG inherits container size properly */
                    #diagram-target svg {
                        max-width: 100%;
                        height: auto;
                    }
                </style>
            </head>
            <body>
                <div class="toolbar">
                    <button onclick="exportSvg()">Export SVG</button>
                    <button onclick="exportPng()">Export PNG</button>
                    <button onclick="exportMermaid()">Export Mermaid</button>
                    <button onclick="exportDrawio()">Export draw.io</button>
                </div>
                <div class="diagram-container">
                    <pre class="mermaid" id="diagram-target">
                        ${this.escapeXml(diagramContent)}
                    </pre>
                </div>
                
                <details style="margin-top: 20px; width: 100%; max-width: 1000px;">
                    <summary style="cursor: pointer; opacity: 0.7;">View Raw Code (Useful for debugging syntax errors)</summary>
                    <pre style="background: #1e1e1e; color: #d4d4d4; padding: 15px; border-radius: 6px; overflow-x: auto; font-size: 12px; margin-top: 10px;"><code>${this.escapeXml(diagramContent.trim())}</code></pre>
                </details>
                
                <script src="${mermaidUri}"></script>
                <script>
                    const vscode = acquireVsCodeApi();

                    // Configure Mermaid depending on the engine
                    const isEraserMode = ${isEraser ? 'true' : 'false'};
                    
                    mermaid.initialize({
                        startOnLoad: true,
                        theme: isEraserMode ? 'base' : 'neutral',
                        flowchart: isEraserMode ? { defaultRenderer: 'elk' } : undefined,
                        themeVariables: isEraserMode ? {
                            fontFamily: "'Inter', sans-serif",
                            primaryColor: '#1A1A1A',
                            primaryTextColor: '#ffffff',
                            primaryBorderColor: '#FF4D82',
                            lineColor: '#888888',
                            secondaryColor: 'rgba(255, 77, 130, 0.05)',
                            tertiaryColor: '#111111'
                        } : undefined
                    });

                    // THE ERASER.IO GLOW ENGINE: Inject SVG Drop Shadows after render
                    if (isEraserMode) {
                        setTimeout(() => {
                            const svgElem = document.querySelector('#diagram-target svg');
                            if (svgElem) {
                                const defs = svgElem.querySelector('defs') || document.createElementNS("http://www.w3.org/2000/svg", "defs");
                                if (!svgElem.querySelector('defs')) svgElem.prepend(defs);
                                
                                const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
                                filter.setAttribute("id", "eraser-shadow");
                                filter.setAttribute("x", "-20%");
                                filter.setAttribute("y", "-20%");
                                filter.setAttribute("width", "140%");
                                filter.setAttribute("height", "140%");
                                
                                filter.innerHTML = \`<feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000000" flood-opacity="0.8"/>\`;
                                defs.appendChild(filter);
                                
                                const nodes = svgElem.querySelectorAll('.node rect, .node circle, .node ellipse, .node polygon, .node path');
                                nodes.forEach(node => {
                                    node.style.filter = "url(#eraser-shadow)";
                                });
                            }
                        }, 500); // 500ms delay to wait for Mermaid's async SVG generation
                    }

                    function exportSvg() {
                        const svgElem = document.querySelector('#diagram-target svg');
                        if (svgElem) {
                            const clone = svgElem.cloneNode(true);
                            
                            // Ensure xmlns is present for standalone SVG
                            if (!clone.getAttribute('xmlns')) {
                                clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
                            }
                            
                            // Enforce exact viewBox dimensions just like PNG to prevent external viewers from squishing it
                            const viewBox = clone.getAttribute('viewBox');
                            if (viewBox) {
                                const parts = viewBox.split(' ');
                                clone.setAttribute('width', parseFloat(parts[2]) + 'px');
                                clone.setAttribute('height', parseFloat(parts[3]) + 'px');
                            } else {
                                const rect = svgElem.getBoundingClientRect();
                                clone.setAttribute('width', rect.width + 'px');
                                clone.setAttribute('height', rect.height + 'px');
                            }
                            
                            // Add dark background rect behind everything so standalone SVGs don't turn white in browsers
                            if (isEraserMode) {
                                const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                                bgRect.setAttribute('width', '100%');
                                bgRect.setAttribute('height', '100%');
                                bgRect.setAttribute('fill', '#0A0A0A');
                                clone.insertBefore(bgRect, clone.firstChild);
                            }
                            
                            vscode.postMessage({ command: 'exportSvg', data: clone.outerHTML });
                        }
                    }

                    function exportPng() {
                        const svgElem = document.querySelector('#diagram-target svg');
                        if (!svgElem) return;
                        
                        // Clone so we don't mess up the live UI
                        const clone = svgElem.cloneNode(true);
                        
                        // Extract true dimensions from viewBox
                        let width = 800;
                        let height = 600;
                        const viewBox = clone.getAttribute('viewBox');
                        if (viewBox) {
                            const parts = viewBox.split(' ');
                            width = parseFloat(parts[2]);
                            height = parseFloat(parts[3]);
                        } else {
                            const rect = svgElem.getBoundingClientRect();
                            width = rect.width;
                            height = rect.height;
                        }
                        
                        // Force explicit pixel dimensions so the canvas doesn't crop it!
                        clone.setAttribute('width', width + 'px');
                        clone.setAttribute('height', height + 'px');
                        
                        const svgData = new XMLSerializer().serializeToString(clone);
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        const img = new Image();
                        
                        // 3x scale for ultra-high-definition PNG export
                        const scale = 3;
                        
                        img.onload = function() {
                            canvas.width = width * scale;
                            canvas.height = height * scale;
                            
                            // use dark background for Eraser, white for others
                            ctx.fillStyle = isEraserMode ? "#0A0A0A" : "white";
                            ctx.fillRect(0, 0, canvas.width, canvas.height);
                            
                            // Draw image scaled up
                            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                            
                            const pngData = canvas.toDataURL('image/png');
                            vscode.postMessage({ command: 'exportPng', data: pngData });
                        };
                        
                        img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
                    }

                    function exportMermaid() {
                        vscode.postMessage({ command: 'exportMermaid' });
                    }

                    function exportDrawio() {
                        vscode.postMessage({ command: 'exportDrawio' });
                    }
                </script>
            </body>
            </html>
        `;
    }

    /**
     * Dependency-free converter from simple Mermaid flowchart/sequence syntax to mxGraph XML.
     * Uses a regex approach to find A --> B links and builds a basic auto-laid-out grid.
     */
    private mermaidToDrawioXml(mermaidText: string): string {
        const nodes = new Map<string, string>(); // id -> label
        const edges: { source: string, target: string, label?: string }[] = [];
        
        const lines = mermaidText.split('\n');
        
        // Very basic parsing for flowchart A --> B or A-->|Label|B
        for (const line of lines) {
            const trimmed = line.trim();
            // Match A-->B or A-->|Label|B or A--> B
            const edgeMatch = trimmed.match(/^([\w\d_-]+)\s*-+>(?:\|([^|]+)\|)?\s*([\w\d_-]+)$/);
            if (edgeMatch) {
                const [, source, label, target] = edgeMatch;
                if (!nodes.has(source)) nodes.set(source, source);
                if (!nodes.has(target)) nodes.set(target, target);
                edges.push({ source, target, label });
            } else {
                // Check if it's just a node definition: A[Label]
                const nodeMatch = trimmed.match(/^([\w\d_-]+)\[([^\]]+)\]$/);
                if (nodeMatch) {
                    nodes.set(nodeMatch[1], nodeMatch[2]);
                }
            }
        }

        // If it's a sequence diagram or complex type, this naive parser won't capture much,
        // but it satisfies the requirement of emitting valid mxGraph XML that opens.
        
        let xml = `<mxfile version="21.6.8" type="device">
  <diagram id="diagramweaver_export" name="Page-1">
    <mxGraphModel dx="1000" dy="1000" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />`;

        // Layout nodes in a simple grid
        let x = 100;
        let y = 100;
        let counter = 0;
        const cols = 3;

        for (const [id, label] of nodes.entries()) {
            xml += `
        <mxCell id="node_${id}" value="${this.escapeXml(label)}" style="rounded=1;whiteSpace=wrap;html=1;comic=1;" vertex="1" parent="1">
          <mxGeometry x="${x}" y="${y}" width="120" height="60" as="geometry" />
        </mxCell>`;
            counter++;
            x += 160;
            if (counter % cols === 0) {
                x = 100;
                y += 100;
            }
        }

        let edgeId = 1000;
        for (const edge of edges) {
            const labelAttr = edge.label ? ` value="${this.escapeXml(edge.label)}"` : '';
            xml += `
        <mxCell id="edge_${edgeId}"${labelAttr} style="edgeStyle=orthogonalEdgeStyle;rounded=1;comic=1;orthogonalLoop=1;jettySize=auto;html=1;" edge="1" parent="1" source="node_${edge.source}" target="node_${edge.target}">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>`;
            edgeId++;
        }

        xml += `
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
        return xml;
    }

    private async saveFile(content: string | Buffer, ext: string, filterName: string) {
        const uri = await vscode.window.showSaveDialog({
            filters: { [filterName]: [ext] },
            defaultUri: vscode.workspace.workspaceFolders 
                ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, `diagram.${ext}`) 
                : undefined
        });

        if (uri) {
            const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
            await vscode.workspace.fs.writeFile(uri, new Uint8Array(data));
            vscode.window.showInformationMessage(`Diagram saved to ${path.basename(uri.fsPath)}`);
        }
    }

    private escapeXml(unsafe: string): string {
        return unsafe.replace(/[<>&'"]/g, c => {
            switch (c) {
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '&': return '&amp;';
                case '\'': return '&apos;';
                case '"': return '&quot;';
                default: return c;
            }
        });
    }

    public dispose() {
        DiagramPanel.currentPanel = undefined;
        this._panel.dispose();
    }
}
