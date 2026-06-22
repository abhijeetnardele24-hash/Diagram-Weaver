import * as vscode from 'vscode';
import { generateDiagramFromPrompt, DiagramResult } from './promptEngine';
import { DiagramPanel } from './diagramPanel';
import { callGroq } from './groqClient';
import { callGemini } from './geminiClient';
import { createVSCodeLMGenerator } from './promptEngine';

export class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'diagramweaver.sidebarView';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'generateDiagram':
                    await this.handleGenerateDiagram(data.prompt, data.provider, data.apiKey, data.style);
                    break;
                case 'saveKey':
                    await this.handleSaveKey(data.provider, data.apiKey);
                    break;
                case 'scanProject':
                    await this.handleScanProject(data.provider, data.apiKey, data.style);
                    break;
                case 'onReady':
                    this.sendInitialState();
                    break;
            }
        });
    }

    private sendInitialState() {
        const config = vscode.workspace.getConfiguration();
        const groqKey = config.get<string>('diagramWeaver.groqApiKey') || '';
        const geminiKey = config.get<string>('diagramWeaver.geminiApiKey') || '';
        
        if (this._view) {
            this._view.webview.postMessage({
                type: 'initialState',
                groqKeySaved: !!groqKey,
                geminiKeySaved: !!geminiKey
            });
        }
    }

    private async handleSaveKey(provider: string, apiKey: string) {
        const config = vscode.workspace.getConfiguration();
        if (provider === 'groq') {
            await config.update('diagramWeaver.groqApiKey', apiKey, vscode.ConfigurationTarget.Global);
        } else if (provider === 'gemini') {
            await config.update('diagramWeaver.geminiApiKey', apiKey, vscode.ConfigurationTarget.Global);
        }
        vscode.window.showInformationMessage(`Saved ${provider} API Key successfully.`);
        this.sendInitialState();
    }

    private async getGenerateFn(provider: string, apiKey: string) {
        const config = vscode.workspace.getConfiguration();
        
        if (provider === 'groq') {
            const key = apiKey || config.get<string>('diagramWeaver.groqApiKey');
            if (!key) throw new Error("Groq API key is missing.");
            return (sys: string, usr: string) => callGroq(key, sys, usr);
        } 
        else if (provider === 'gemini') {
            const key = apiKey || config.get<string>('diagramWeaver.geminiApiKey');
            if (!key) throw new Error("Gemini API key is missing.");
            return (sys: string, usr: string) => callGemini(key, sys, usr);
        } 
        else if (provider === 'copilot') {
            const models = await vscode.lm.selectChatModels();
            if (models.length === 0) {
                throw new Error("No Copilot models found. Please use Groq or Gemini instead.");
            }
            // Prefer gpt-4 or claude-3.5
            models.sort((a, b) => {
                const n = (a.id + a.vendor + a.name).toLowerCase();
                return n.includes('gpt-4') || n.includes('claude') ? -1 : 1;
            });
            const cancelToken = new vscode.CancellationTokenSource().token;
            return createVSCodeLMGenerator(models[0], cancelToken);
        }
        throw new Error("Unknown provider.");
    }

    private async handleGenerateDiagram(prompt: string, provider: string, apiKey: string, style?: string) {
        try {
            const generateText = await this.getGenerateFn(provider, apiKey);
            
            DiagramPanel.createOrShow(this._extensionUri);
            if (DiagramPanel.currentPanel) {
                DiagramPanel.currentPanel.showLoading('Weaving Diagram...');
            }

            const result = await generateDiagramFromPrompt(generateText, prompt, style);
            
            if (result.type === 'mermaid' && DiagramPanel.currentPanel) {
                DiagramPanel.currentPanel.renderDiagram(result.content, style);
            }
            
            this._view?.webview.postMessage({ type: 'generateSuccess' });
        } catch (error: any) {
            vscode.window.showErrorMessage(`Diagram Generation Failed: ${error.message}`);
            this._view?.webview.postMessage({ type: 'generateError', message: error.message });
            if (DiagramPanel.currentPanel) {
                DiagramPanel.currentPanel.dispose();
            }
        }
    }

    private async handleScanProject(provider: string, apiKey: string, style?: string) {
        try {
            if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
                vscode.window.showWarningMessage('Please open a project folder in VS Code first to use Auto-Scan.');
                this._view?.webview.postMessage({ type: 'generateError', message: "No workspace opened" });
                return;
            }

            vscode.window.showInformationMessage('🔍 Scanning workspace files...');
            const files = await vscode.workspace.findFiles('**/*.*', '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**}');
            if (files.length === 0) {
                vscode.window.showWarningMessage('No files found in workspace to scan.');
                this._view?.webview.postMessage({ type: 'generateError', message: "No files found" });
                return;
            }
            
            const filePaths = files.map(f => vscode.workspace.asRelativePath(f)).slice(0, 50);
            const prompt = `Generate a high-level architecture flowchart showing the relationships between these files and directories. Group related files into subgraphs:\n\n${filePaths.join('\n')}`;
            
            await this.handleGenerateDiagram(prompt, provider, apiKey, style);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Scan Failed: ${error.message}`);
            this._view?.webview.postMessage({ type: 'generateError', message: error.message });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Resolve paths for media
        const qrUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'qr.png'));

        // We will build the HTML inline here so it's fully compiled inside the TS output
        // without needing to bundle external HTML/CSS files.
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Diagram Weaver</title>
    <style>
        :root {
            --bg-color: var(--vscode-sideBar-background);
            --text-color: var(--vscode-sideBarTitle-foreground);
            --input-bg: var(--vscode-input-background);
            --input-fg: var(--vscode-input-foreground);
            --input-border: var(--vscode-input-border);
            --border-color: var(--vscode-widget-border, rgba(255,255,255,0.08));
            --radius: 8px;
            --font: var(--vscode-font-family);
            --primary-gradient: linear-gradient(135deg, #E2E83F 0%, #D1D82E 100%);
            --primary-hover: linear-gradient(135deg, #F0F64F 0%, #E2E83F 100%);
        }
        
        body {
            font-family: var(--font);
            color: var(--text-color);
            background-color: var(--bg-color);
            padding: 20px 16px;
            margin: 0;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            gap: 24px;
        }

        h2 {
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin: 0 0 12px 0;
            opacity: 0.8;
        }

        .card {
            background: linear-gradient(145deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.01) 100%);
            border: 1px solid var(--border-color);
            border-radius: 10px;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 14px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }

        label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-weight: 700;
            color: var(--vscode-descriptionForeground, rgba(255,255,255,0.7));
        }

        select, input, textarea {
            width: 100%;
            box-sizing: border-box;
            background: var(--input-bg);
            color: var(--input-fg);
            border: 1px solid var(--input-border);
            padding: 10px 12px;
            border-radius: var(--radius);
            font-family: var(--font);
            font-size: 13px;
            outline: none;
            transition: all 0.2s ease;
        }

        select:focus, input:focus, textarea:focus {
            border-color: #3b82f6;
            box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
        }

        textarea {
            resize: vertical;
            min-height: 90px;
            line-height: 1.4;
        }

        button {
            background: var(--primary-gradient);
            color: #111827;
            border: none;
            padding: 12px;
            border-radius: var(--radius);
            font-weight: 600;
            font-size: 13px;
            cursor: pointer;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            box-shadow: 0 2px 8px rgba(37, 99, 235, 0.3);
        }

        button:hover {
            background: var(--primary-hover);
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4);
        }

        button:active {
            transform: translateY(0);
        }

        .btn-secondary {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid var(--border-color);
            color: var(--text-color);
            box-shadow: none;
        }

        .btn-secondary:hover {
            background: rgba(255, 255, 255, 0.1);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            border-color: rgba(255,255,255,0.15);
        }

        #api-key-container {
            background: rgba(0, 0, 0, 0.15);
            padding: 12px;
            border-radius: 8px;
            border: 1px solid var(--border-color);
        }

        .hidden {
            display: none !important;
        }

        .status {
            font-size: 12px;
            color: var(--vscode-notificationsInfoIcon-foreground);
            text-align: center;
            margin-top: -8px;
        }

        .loader {
            border: 2px solid rgba(255,255,255,0.1);
            border-top: 2px solid white;
            border-radius: 50%;
            width: 14px;
            height: 14px;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>

    <div class="card">
        <label>AI Provider</label>
        <select id="provider">
            <option value="groq">Groq (Ultra Fast - Free)</option>
            <option value="gemini">Gemini (Free)</option>
            <option value="copilot">GitHub Copilot</option>
        </select>

        <div id="api-key-container">
            <label id="api-key-label">Groq API Key</label>
            <input type="password" id="api-key" placeholder="gsk_..." />
            <button class="btn-secondary" id="save-key-btn" style="padding: 6px; font-size: 11px;">Save Key</button>
            <div style="font-size: 11px; opacity: 0.7; margin-top: -4px;">
                <a href="#" id="get-key-link">Get Free Key</a>
            </div>
        </div>
    </div>

    <div class="card">
        <label>Diagram Style</label>
        <select id="style">
            <option value="Mermaid Classic">🔷 Mermaid Classic</option>
            <option value="Eraser.io Style (Beautiful Modern)">🎨 Eraser.io — Beautiful Modern</option>
            <option value="Draw.io (Advanced)">📐 Draw.io — Advanced Export</option>
        </select>
    </div>

    <div class="card">
        <label>Describe Architecture</label>
        <textarea id="prompt" placeholder="e.g. A React frontend talking to a Node backend with MongoDB..."></textarea>
        <button id="generate-btn">
            <span id="generate-icon">✨</span> Generate Diagram
        </button>
        <div id="generate-status" class="status hidden">Generating...</div>
    </div>

    <div class="card">
        <label>Workspace Intelligence</label>
        <button id="scan-btn" class="btn-secondary">
            <span>🔍</span> Auto-Scan Project
        </button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        let state = { groqKeySaved: false, geminiKeySaved: false };

        // Elements
        const providerSelect = document.getElementById('provider');
        const styleSelect = document.getElementById('style');
        const keyContainer = document.getElementById('api-key-container');
        const keyInput = document.getElementById('api-key');
        const keyLabel = document.getElementById('api-key-label');
        const getKeyLink = document.getElementById('get-key-link');
        const saveKeyBtn = document.getElementById('save-key-btn');
        const promptInput = document.getElementById('prompt');
        const generateBtn = document.getElementById('generate-btn');
        const scanBtn = document.getElementById('scan-btn');
        const generateIcon = document.getElementById('generate-icon');

        // Setup
        vscode.postMessage({ type: 'onReady' });

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'initialState':
                    state.groqKeySaved = message.groqKeySaved;
                    state.geminiKeySaved = message.geminiKeySaved;
                    updateUI();
                    break;
                case 'generateSuccess':
                case 'generateError':
                    setLoading(false);
                    break;
            }
        });

        providerSelect.addEventListener('change', updateUI);

        function updateUI() {
            const val = providerSelect.value;
            if (val === 'copilot') {
                keyContainer.classList.add('hidden');
            } else {
                keyContainer.classList.remove('hidden');
                if (val === 'groq') {
                    keyLabel.innerText = 'Groq API Key';
                    keyInput.placeholder = 'gsk_...';
                    getKeyLink.href = 'https://console.groq.com/keys';
                    keyContainer.style.display = state.groqKeySaved ? 'none' : 'flex';
                } else {
                    keyLabel.innerText = 'Gemini API Key';
                    keyInput.placeholder = 'AIza...';
                    getKeyLink.href = 'https://aistudio.google.com/app/apikey';
                    keyContainer.style.display = state.geminiKeySaved ? 'none' : 'flex';
                }
            }
        }

        saveKeyBtn.addEventListener('click', () => {
            const key = keyInput.value.trim();
            if (key) {
                vscode.postMessage({
                    type: 'saveKey',
                    provider: providerSelect.value,
                    apiKey: key
                });
            }
        });

        function setLoading(isLoading) {
            generateBtn.disabled = isLoading;
            scanBtn.disabled = isLoading;
            generateIcon.innerHTML = isLoading ? '<div class="loader"></div>' : '✨';
        }

        generateBtn.addEventListener('click', () => {
            const prompt = promptInput.value.trim();
            if (!prompt) return;
            setLoading(true);
            vscode.postMessage({
                type: 'generateDiagram',
                provider: providerSelect.value,
                apiKey: keyInput.value.trim(),
                prompt: prompt,
                style: styleSelect.value
            });
        });

        scanBtn.addEventListener('click', () => {
            setLoading(true);
            vscode.postMessage({
                type: 'scanProject',
                provider: providerSelect.value,
                apiKey: keyInput.value.trim(),
                style: styleSelect.value
            });
        });

    </script>
</body>
</html>`;
    }
}
