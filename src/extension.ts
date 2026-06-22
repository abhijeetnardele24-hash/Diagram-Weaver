import * as vscode from 'vscode';
import { generateDiagramFromPrompt, DiagramResult, GenerateTextFn, createVSCodeLMGenerator } from './promptEngine';
import { DiagramPanel } from './diagramPanel';
import { callGemini, validateGeminiKey } from './geminiClient';
import { callGroq, validateGroqKey } from './groqClient';
import { Buffer } from 'buffer';

const DIAGRAM_PARTICIPANT_ID = 'diagramweaver.diagram';
const CONFIG_KEY_GEMINI = 'diagramWeaver.geminiApiKey';
const CONFIG_KEY_GROQ   = 'diagramWeaver.groqApiKey';

// ─── AI Provider Selection ──────────────────────────────────────────────────

/**
 * Gets the saved Gemini API key from VS Code settings.
 */
function getSavedGeminiKey(): string {
    return vscode.workspace.getConfiguration().get<string>(CONFIG_KEY_GEMINI, '').trim();
}
function getSavedGroqKey(): string {
    return vscode.workspace.getConfiguration().get<string>(CONFIG_KEY_GROQ, '').trim();
}

async function saveGeminiKey(key: string): Promise<void> {
    await vscode.workspace.getConfiguration().update(CONFIG_KEY_GEMINI, key, vscode.ConfigurationTarget.Global);
}
async function saveGroqKey(key: string): Promise<void> {
    await vscode.workspace.getConfiguration().update(CONFIG_KEY_GROQ, key, vscode.ConfigurationTarget.Global);
}

/**
 * Shows the provider selection QuickPick and returns a ready-to-use GenerateTextFn.
 * - Option 1: Gemini API (Free) — no Copilot needed
 * - Option 2: GitHub Copilot — uses vscode.lm
 * Returns undefined if the user cancels.
 */
async function selectAIProvider(token?: vscode.CancellationToken): Promise<GenerateTextFn | undefined> {
    // Auto-use saved keys without showing picker again
    const savedGroq = getSavedGroqKey();
    if (savedGroq) { return (sys, usr) => callGroq(savedGroq, sys, usr); }

    const savedGemini = getSavedGeminiKey();
    if (savedGemini) { return (sys, usr) => callGemini(savedGemini, sys, usr); }

    // Show provider selection — Groq first as recommended
    const choice = await vscode.window.showQuickPick(
        [
            {
                label: '$(rocket) Groq (Free + Fastest — Recommended)',
                description: 'Get a free key at console.groq.com/keys',
                detail: '✅ No credit card • ⚡ 1–3 second responses • 🆓 30 req/min free',
                id: 'groq'
            },
            {
                label: '$(globe) Gemini API (Free)',
                description: 'Get a free key at aistudio.google.com',
                detail: '1 million tokens/month FREE. May have regional restrictions.',
                id: 'gemini'
            },
            {
                label: '$(copilot) GitHub Copilot',
                description: 'Uses your existing Copilot subscription',
                detail: 'Requires GitHub Copilot Chat to be installed and active.',
                id: 'copilot'
            }
        ],
        {
            placeHolder: 'Choose your AI provider for Diagram Weaver',
            title: '✦ Diagram Weaver — Select AI Provider'
        }
    );

    if (!choice) { return undefined; }

    if (choice.id === 'groq')   { return setupGroqProvider(); }
    if (choice.id === 'gemini') { return setupGeminiProvider(); }
    return setupCopilotProvider(token);
}

/**
 * Prompts the user for their Groq API key, validates format, saves it.
 */
async function setupGroqProvider(): Promise<GenerateTextFn | undefined> {
    const key = await vscode.window.showInputBox({
        prompt: '⚡ Enter your FREE Groq API Key',
        placeHolder: 'Paste your key here (starts with gsk_  — from console.groq.com/keys)',
        ignoreFocusOut: true,
        validateInput: (val) => {
            if (!val || val.trim().length < 10) { return 'Please enter a valid API key'; }
            return null;
        }
    });

    if (!key) { return undefined; }

    try {
        validateGroqKey(key.trim());
    } catch (err: any) {
        vscode.window.showErrorMessage(err.message);
        return undefined;
    }

    await saveGroqKey(key.trim());
    vscode.window.showInformationMessage('✅ Groq API key saved! Diagram Weaver will use Groq automatically from now on.');
    return (sys, usr) => callGroq(key.trim(), sys, usr);
}

/**
 * Prompts the user for their Gemini API key, validates it, saves it, and returns a GenerateTextFn.
 */
async function setupGeminiProvider(): Promise<GenerateTextFn | undefined> {

    const key = await vscode.window.showInputBox({
        prompt: '🔑 Enter your FREE Gemini API Key',
        placeHolder: 'Paste your key here (from aistudio.google.com)',
        ignoreFocusOut: true,
        password: false,
        validateInput: (val) => {
            if (!val || val.trim().length < 10) {
                return 'Please enter a valid API key';
            }
            return null;
        }
    });

    if (!key) { return undefined; }

    // Validate the key before saving
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Validating Gemini API Key...' },
        async () => {
            await validateGeminiKey(key.trim());
        }
    );

    await saveGeminiKey(key.trim());
    vscode.window.showInformationMessage('✅ Gemini API key saved! Diagram Weaver will use it automatically from now on.');

    return (sys: string, usr: string) => callGemini(key.trim(), sys, usr);
}

/**
 * Sets up the GitHub Copilot provider using vscode.lm.
 */
async function setupCopilotProvider(token?: vscode.CancellationToken): Promise<GenerateTextFn | undefined> {
    const models = await vscode.lm.selectChatModels();

    if (models.length === 0) {
        vscode.window.showErrorMessage(
            'No Copilot models found. Please install GitHub Copilot Chat, or use Gemini (Free) instead.',
            'Get Free Gemini Key'
        ).then(action => {
            if (action === 'Get Free Gemini Key') {
                vscode.env.openExternal(vscode.Uri.parse('https://aistudio.google.com/app/apikey'));
            }
        });
        return undefined;
    }

    // Sort: prefer GPT-4, Claude 3.5, etc.
    models.sort((a, b) => {
        const score = (m: vscode.LanguageModelChat) => {
            const n = (m.id + m.vendor + m.name).toLowerCase();
            if (n.includes('gpt-4') || n.includes('o1') || n.includes('claude-3-5')) { return 100; }
            if (n.includes('claude-3') || n.includes('opus')) { return 90; }
            if (n.includes('gpt-3.5')) { return 50; }
            return 10;
        };
        return score(b) - score(a);
    });

    const cancelToken = token ?? new vscode.CancellationTokenSource().token;

    // Return a function that tries each model with fallback
    return async (sys: string, usr: string): Promise<string> => {
        let lastError: any;
        for (const model of models) {
            try {
                return await createVSCodeLMGenerator(model, cancelToken)(sys, usr);
            } catch (err: any) {
                lastError = err;
                console.log(`Model ${model.id} failed: ${err.message}`);
            }
        }
        throw lastError || new Error('All Copilot models failed.');
    };
}

import { SidebarProvider } from './sidebarProvider';

// ─── Extension Activation ───────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {

    // Register Sidebar Provider
    const sidebarProvider = new SidebarProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            SidebarProvider.viewType,
            sidebarProvider
        )
    );

    // 1. Register Chat Participant (works with Copilot Chat)
    const handler: vscode.ChatRequestHandler = async (
        request: vscode.ChatRequest,
        _chatContext: vscode.ChatContext,
        response: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ) => {
        let userPrompt = request.prompt;

        // For the chat participant, prefer saved Gemini key, else use the model provided by Copilot Chat directly
        let generateText: GenerateTextFn;
        const savedKey = getSavedGeminiKey();

        if (savedKey) {
            generateText = (sys, usr) => callGemini(savedKey, sys, usr);
        } else {
            // Copilot Chat provides the model directly via request.model
            const models = await vscode.lm.selectChatModels();
            if (models.length === 0) {
                response.markdown('⚠️ **No AI provider configured.**\n\nRun **Diagram Weaver: Weave Diagram** from the Command Palette to set up your free Gemini API key.');
                return;
            }
            generateText = createVSCodeLMGenerator(models[0], token);
        }

        response.progress('Analyzing request...');

        try {
            const generateWithFallback = (prompt: string, style?: string) =>
                generateDiagramFromPrompt(generateText, prompt, style);

            if (request.command === 'fromSelection') {
                const editor = vscode.window.activeTextEditor;
                if (!editor || editor.selection.isEmpty) {
                    response.markdown('No code selected. Please highlight some code and try again.');
                    return;
                }
                const selectedCode = editor.document.getText(editor.selection);
                userPrompt = `Generate a diagram for the following code:\n\n${selectedCode}\n\nAdditional user instructions: ${userPrompt}`;

                DiagramPanel.createOrShow(context.extensionUri);
                if (DiagramPanel.currentPanel) {
                    DiagramPanel.currentPanel.showLoading('Weaving Diagram from selection...');
                }
                response.progress('Generating diagram from code selection...');
                const result = await generateWithFallback(userPrompt);
                if (result.type === 'mermaid') {
                    openDiagram(result.content, context.extensionUri);
                    response.markdown('Diagram generated and opened in a new tab.');
                } else {
                    response.markdown(`**MCP Tool Executed**:\n\n${result.content}`);
                }

            } else if (request.command === 'explainProject') {
                response.progress('Scanning workspace files...');
                const files = await vscode.workspace.findFiles('**/*.*', '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**}');
                const filePaths = files.map(f => vscode.workspace.asRelativePath(f)).slice(0, 50);
                userPrompt = `Generate a high-level architecture diagram showing the relationships between these files/components:\n\n${filePaths.join('\n')}\n\nAdditional user instructions: ${userPrompt}`;

                DiagramPanel.createOrShow(context.extensionUri);
                if (DiagramPanel.currentPanel) {
                    DiagramPanel.currentPanel.showLoading('Weaving Architecture Diagram...');
                }
                response.progress('Generating architecture diagram...');
                const result = await generateWithFallback(userPrompt);
                if (result.type === 'mermaid') {
                    openDiagram(result.content, context.extensionUri);
                    response.markdown('Project architecture diagram generated successfully.');
                } else {
                    response.markdown(`**MCP Tool Executed**:\n\n${result.content}`);
                }

            } else if (request.command === 'generateDocs') {
                response.progress('Generating architecture diagram...');
                const files = await vscode.workspace.findFiles('**/*.*', '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**}');
                const filePaths = files.map(f => vscode.workspace.asRelativePath(f)).slice(0, 50);
                userPrompt = `Generate an architecture diagram for these files:\n${filePaths.join('\n')}\n\n${userPrompt}`;
                const result = await generateWithFallback(userPrompt);

                if (result.type === 'mcp_result') {
                    response.markdown(`**MCP Tool Executed**:\n\n${result.content}`);
                    return;
                }
                if (vscode.workspace.workspaceFolders) {
                    const wsPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
                    const docPath = vscode.Uri.file(wsPath + '/ARCHITECTURE.md');
                    const content = Buffer.from(`# Project Architecture\n\nGenerated by Diagram Weaver.\n\n\`\`\`mermaid\n${result.content}\n\`\`\`\n`, 'utf8');
                    await vscode.workspace.fs.writeFile(docPath, new Uint8Array(content));
                    response.markdown('Created `ARCHITECTURE.md` in your workspace.');
                    openDiagram(result.content, context.extensionUri);
                } else {
                    response.markdown('No workspace open to save ARCHITECTURE.md.');
                }

            } else {
                DiagramPanel.createOrShow(context.extensionUri);
                if (DiagramPanel.currentPanel) {
                    DiagramPanel.currentPanel.showLoading('Weaving Diagram...');
                }
                response.progress('Weaving diagram...');
                const result = await generateWithFallback(userPrompt);
                if (result.type === 'mermaid') {
                    openDiagram(result.content, context.extensionUri);
                    response.markdown('Your diagram is ready! Use the export buttons in the panel to save it.');
                } else {
                    response.markdown(`**MCP Tool Executed**:\n\n${result.content}`);
                }
            }
        } catch (error: any) {
            response.markdown(`**Error:** ${error.message}\n\nPlease try rephrasing your request.`);
        }
    };

    const participant = vscode.chat.createChatParticipant(DIAGRAM_PARTICIPANT_ID, handler);
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png');
    context.subscriptions.push(participant);

    // 2. Command: Weave Diagram (with AI provider selection)
    context.subscriptions.push(
        vscode.commands.registerCommand('diagramweaver.generate', async () => {

            // Step 1: Select AI Provider
            const generateText = await selectAIProvider();
            if (!generateText) { return; }

            // Step 2: Choose diagram source
            const selectedSource = await vscode.window.showQuickPick(
                ['Auto-Scan Current Project', 'Write Custom Prompt'],
                { placeHolder: 'How do you want to generate the diagram?' }
            );
            if (!selectedSource) { return; }

            let userPrompt = '';

            if (selectedSource === 'Write Custom Prompt') {
                const input = await vscode.window.showInputBox({
                    prompt: 'Describe the diagram you want to generate',
                    placeHolder: 'e.g., flowchart of user login with JWT auth',
                    validateInput: text => text.length > 5000 ? 'Prompt too long (max 5000 chars).' : null
                });
                if (!input) { return; }
                userPrompt = input;
            } else {
                vscode.window.showInformationMessage('Deep scanning workspace for architecture context...');
                const files = await vscode.workspace.findFiles('**/*.*', '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**}');
                if (files.length === 0) {
                    vscode.window.showErrorMessage('No files found in workspace.');
                    return;
                }
                const filePaths = files.map(f => vscode.workspace.asRelativePath(f)).slice(0, 50);

                let pkgContext = '';
                const pkgFiles = await vscode.workspace.findFiles('package.json', null, 1);
                if (pkgFiles.length > 0) {
                    const doc = await vscode.workspace.openTextDocument(pkgFiles[0]);
                    const raw = doc.getText();
                    pkgContext = `Project Info from package.json: ${raw.length > 2000 ? raw.substring(0, 2000) + '...' : raw}\n\n`;
                }

                userPrompt = `Analyze the following project structure, files, and package dependencies. Generate a highly detailed architecture diagram showing the relationships between the core components, modules, databases, and dependencies.\n\n${pkgContext}Files:\n${filePaths.join('\n')}`;
            }

            // Step 3: Generate directly — no style picker needed
            const selectedEngine = 'Mermaid Classic';

            // Step 4: Generate!
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Diagram Weaver is generating your diagram...',
                cancellable: false
            }, async () => {
                try {
                    DiagramPanel.createOrShow(context.extensionUri);
                    if (DiagramPanel.currentPanel) {
                        DiagramPanel.currentPanel.showLoading(`Weaving Diagram...`);
                    }

                    const result = await generateDiagramFromPrompt(generateText, userPrompt, selectedEngine);

                    if (result.type === 'mermaid') {
                        openDiagram(result.content, context.extensionUri, selectedEngine);
                    } else {
                        vscode.window.showInformationMessage('MCP Tool Executed successfully!');
                        const doc = await vscode.workspace.openTextDocument({ content: result.content, language: 'json' });
                        vscode.window.showTextDocument(doc);
                    }
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Diagram Weaver Error: ${error.message}`);
                }
            });
        })
    );


    // 3. Command: Reset AI Provider (lets user switch between Gemini/Copilot)
    context.subscriptions.push(
        vscode.commands.registerCommand('diagramweaver.resetProvider', async () => {
            await vscode.workspace.getConfiguration().update(CONFIG_KEY_GROQ,   '', vscode.ConfigurationTarget.Global);
            await vscode.workspace.getConfiguration().update(CONFIG_KEY_GEMINI, '', vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage('✅ AI provider reset. Run Weave Diagram again to choose Groq, Gemini, or Copilot.');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('diagramweaver.openLast', () => {
            if (DiagramPanel.currentPanel) {
                DiagramPanel.createOrShow(context.extensionUri);
            } else {
                vscode.window.showInformationMessage('No diagram is currently active.');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('diagramweaver.exportDiagram', () => {
            if (DiagramPanel.currentPanel) {
                vscode.window.showInformationMessage('Please use the export buttons inside the diagram panel.');
            } else {
                vscode.window.showInformationMessage('No diagram is currently active.');
            }
        })
    );
}

function openDiagram(source: string, extensionUri: vscode.Uri, engine?: string) {
    DiagramPanel.createOrShow(extensionUri);
    if (DiagramPanel.currentPanel) {
        DiagramPanel.currentPanel.renderDiagram(source, engine);
    }
}

import { deactivateMcp } from './mcpClient';

export async function deactivate() {
    await deactivateMcp();
}
