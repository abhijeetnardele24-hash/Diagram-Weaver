import * as vscode from 'vscode';
import { generateDiagramFromPrompt, DiagramResult } from './promptEngine';
import { DiagramPanel } from './diagramPanel';
import { Buffer } from 'buffer';        

const DIAGRAM_PARTICIPANT_ID = 'diagramweaver.diagram';

export function activate(context: vscode.ExtensionContext) {
    // 1. Register Chat Participant
    const handler: vscode.ChatRequestHandler = async (
        request: vscode.ChatRequest,
        chatContext: vscode.ChatContext,
        response: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ) => {
        let userPrompt = request.prompt;
        
        // Get all available language models
        const models = await vscode.lm.selectChatModels();
        
        if (models.length === 0) {
            response.markdown('No language models found. Ensure your AI features are enabled.');
            return;
        }

        response.progress('Analyzing request...');

        try {
            // Helper function to execute prompt with fallback
            const generateWithFallback = async (prompt: string, diagramStyle?: string): Promise<DiagramResult> => {
                let lastError: any;
                for (const model of models) {
                    try {
                        return await generateDiagramFromPrompt(model, prompt, token, diagramStyle);
                    } catch (err: any) {
                        lastError = err;
                        console.log(`Model ${model.id} failed: ${err.message}`);
                    }
                }
                throw lastError || new Error('All available language models failed.');
            };

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
                    DiagramPanel.currentPanel.showLoading("Weaving Diagram from selection...");
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
                // Scan workspace files (no AI, fast & free)
                const files = await vscode.workspace.findFiles('**/*.*', '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**}');
                const filePaths = files.map(f => vscode.workspace.asRelativePath(f)).slice(0, 50); // limit to 50 to avoid token explosion
                
                const fileTreeText = filePaths.join('\n');
                userPrompt = `Generate a high-level architecture diagram showing the relationships between these files/components:\n\n${fileTreeText}\n\nAdditional user instructions: ${userPrompt}`;
                
                DiagramPanel.createOrShow(context.extensionUri);
                if (DiagramPanel.currentPanel) {
                    DiagramPanel.currentPanel.showLoading("Weaving Architecture Diagram...");
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
                // NEW FEATURE: generateDocs
                response.progress('Generating architecture diagram...');
                const files = await vscode.workspace.findFiles('**/*.*', '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**}');
                const filePaths = files.map(f => vscode.workspace.asRelativePath(f)).slice(0, 50);
                
                userPrompt = `Generate an architecture diagram for these files:\n${filePaths.join('\n')}\n\n${userPrompt}`;
                const result = await generateWithFallback(userPrompt);
                
                if (result.type === 'mcp_result') {
                    response.markdown(`**MCP Tool Executed**:\n\n${result.content}`);
                    return;
                }

                // Write to ARCHITECTURE.md
                if (vscode.workspace.workspaceFolders) {
                    const wsPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
                    const docPath = vscode.Uri.file(wsPath + '/ARCHITECTURE.md');
                    const content = Buffer.from(`# Project Architecture\n\nGenerated by Diagram Weaver.\n\n\`\`\`mermaid\n${result.content}\n\`\`\`\n`, 'utf8');
                    await vscode.workspace.fs.writeFile(docPath, new Uint8Array(content));
                    response.markdown('Created `ARCHITECTURE.md` in your workspace.');
                    
                    // Also preview it
                    openDiagram(result.content, context.extensionUri);
                } else {
                    response.markdown('No workspace open to save ARCHITECTURE.md.');
                }
            } else {
                DiagramPanel.createOrShow(context.extensionUri);
                if (DiagramPanel.currentPanel) {
                    DiagramPanel.currentPanel.showLoading("Weaving Diagram...");
                }

                // Standard natural language diagram generation
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

    // 2. Register Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('diagramweaver.generate', async () => {
            const sourceOptions = ['Auto-Scan Current Project', 'Write Custom Prompt'];
            const selectedSource = await vscode.window.showQuickPick(sourceOptions, {
                placeHolder: 'How do you want to generate the diagram?'
            });
            
            if (!selectedSource) return;
            
            let userPrompt = '';
            
            if (selectedSource === 'Write Custom Prompt') {
                const input = await vscode.window.showInputBox({
                    prompt: 'Describe the diagram you want to generate',
                    placeHolder: 'e.g., flowchart of user login',
                    validateInput: text => {
                        if (text.length > 5000) return 'Prompt is too long (max 5000 characters).';
                        return null;
                    }
                });
                if (!input) return;
                userPrompt = input;
            } else {
                // Auto-Scan Current Project
                vscode.window.showInformationMessage('Deep scanning workspace project for architecture context...');
                const files = await vscode.workspace.findFiles('**/*.*', '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**}');
                if (files.length === 0) {
                    vscode.window.showErrorMessage('No files found in workspace.');
                    return;
                }
                const filePaths = files.map(f => vscode.workspace.asRelativePath(f)).slice(0, 50); // limit 50 to avoid max context
                
                // Read package.json for heavy project context
                let pkgContext = '';
                const pkgFiles = await vscode.workspace.findFiles('package.json', null, 1);
                if (pkgFiles.length > 0) {
                    const doc = await vscode.workspace.openTextDocument(pkgFiles[0]);
                    const rawText = doc.getText();
                    const safeText = rawText.length > 2000 ? rawText.substring(0, 2000) + '...' : rawText;
                    pkgContext = `Project Info from package.json: ${safeText}\\n\\n`;
                }
                
                userPrompt = `Analyze the following project structure, files, and package dependencies. Generate a highly detailed architecture diagram showing the relationships between the core components, modules, databases, and dependencies.\\n\\n${pkgContext}Files:\\n${filePaths.join('\\n')}`;
            }
            
            // SHOW QUICKPICK INSTANTLY BEFORE ANY ASYNC TASKS!
            const engineOptions = ['Mermaid Classic', 'Draw.io (Advanced)', 'Eraser.io Style (Beautiful Modern)'];
            const selectedEngine = await vscode.window.showQuickPick(engineOptions, {
                placeHolder: 'Select Diagram Engine / Style'
            });
            
            if (!selectedEngine) {
                return; // User cancelled
            }
            
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Generating Diagram Weaver sketch...",
                cancellable: false
            }, async (progress) => {
                try {
                    // Fetch models AFTER showing the UI dropdown so it doesn't block
                    const models = await vscode.lm.selectChatModels();
                    if (models.length === 0) {
                        vscode.window.showErrorMessage('No language models found via vscode.lm. Please ensure your AI features are enabled.');
                        return;
                    }
                    
                    // SMART MODEL SELECTOR: Score and sort to use highest-tier logic models first
                    models.sort((a, b) => {
                        const aName = (a.id + ' ' + a.vendor + ' ' + a.name).toLowerCase();
                        const bName = (b.id + ' ' + b.vendor + ' ' + b.name).toLowerCase();
                        
                        const scoreModel = (name: string) => {
                            if (name.includes('gpt-4') || name.includes('o1') || name.includes('claude-3-5') || name.includes('claude-3.5')) return 100;
                            if (name.includes('claude-3') || name.includes('opus')) return 90;
                            if (name.includes('gpt-3.5')) return 50;
                            return 10;
                        };
                        
                        return scoreModel(bName) - scoreModel(aName);
                    });
                    
                    // OPEN THE PANEL IMMEDIATELY AND SHOW LOADING SCREEN
                    DiagramPanel.createOrShow(context.extensionUri);
                    if (DiagramPanel.currentPanel) {
                        DiagramPanel.currentPanel.showLoading(`Weaving Diagram using ${selectedEngine}...`);
                    }

                    let result: DiagramResult | undefined;
                    let lastError: any;

                    // Try each model until one succeeds (fallback for quota limits)
                    for (const fallbackModel of models) {
                        try {
                            // Pass the selected engine to the prompt engine
                            result = await generateDiagramFromPrompt(fallbackModel, userPrompt, new vscode.CancellationTokenSource().token, selectedEngine);
                            break; // Success! Exit the loop.
                        } catch (err: any) {
                            lastError = err;
                            // If it's a quota error, it will just continue to the next loop iteration
                            console.log(`Model ${fallbackModel.id} failed: ${err.message}`);
                        }
                    }

                    if (!result) {
                        vscode.window.showErrorMessage(`All models failed. Last Error: ${lastError?.message}`);
                        return;
                    }
                    
                    if (result.type === 'mermaid') {
                        openDiagram(result.content, context.extensionUri, selectedEngine);
                    } else {
                        vscode.window.showInformationMessage('MCP Tool Executed successfully! See output in new editor window.');
                        const doc = await vscode.workspace.openTextDocument({ content: result.content, language: 'json' });
                        vscode.window.showTextDocument(doc);
                    }
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Error: ${error.message}`);
                }
            });
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
                // Webview handles its own exports, but we could trigger it via postMessage if needed
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
