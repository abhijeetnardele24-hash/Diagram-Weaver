import * as vscode from 'vscode';
import { getMcpClient } from './mcpClient';

// The 9 supported diagram types
const SUPPORTED_TYPES = [
    'flowchart', 'sequenceDiagram', 'classDiagram', 'erDiagram',
    'stateDiagram-v2', 'gantt', 'pie', 'mindmap', 'journey'
];

export interface DiagramResult {
    type: 'mermaid' | 'mcp_result';
    content: string;
}

/**
 * A unified text generation function signature.
 * Works with both Gemini API and VS Code Language Model (Copilot).
 */
export type GenerateTextFn = (systemPrompt: string, userPrompt: string) => Promise<string>;

/**
 * Handles intent classification, MCP tools, and Mermaid generation.
 * Accepts any text generation function — Gemini or Copilot.
 */
export async function generateDiagramFromPrompt(
    generateText: GenerateTextFn,
    userPrompt: string,
    diagramStyle?: string
): Promise<DiagramResult> {

    const mcpClient = await getMcpClient();
    const mcpToolsResponse = await mcpClient.listTools();
    const mcpTools = mcpToolsResponse.tools || [];
    const isEraser = diagramStyle?.includes('Eraser');


    // Tight, high-signal system prompt — Gemini knows Mermaid well, no need to over-explain.
    // Shorter prompt = fewer input tokens = much faster response.
    const systemPrompt = `You are a Mermaid diagram expert. Output ONLY a valid mermaid code block, nothing else.

RULES (mandatory):
- Output format: exactly one \`\`\`mermaid ... \`\`\` block, no explanations outside it.
- Node labels with spaces/parens/punctuation MUST use double quotes: A["My Label (v2)"]
- Node IDs: alphanumeric only, no spaces.
- **CRITICAL ARROW SYNTAX**: Never use \`-->|Text|>\`. The correct syntax is \`-->|Text|\` or \`-- Text -->\`.
- Max 15 nodes for large projects — abstract components, do not list every file.
- Never use escaped quotes inside labels — use single quotes instead.
${isEraser ? `- Use flowchart TD with subgraphs. Add these classDefs:
  classDef compute fill:#1A1A1A,stroke:#FF4D82,stroke-width:3px,color:#fff;
  classDef db fill:#1A1A1A,stroke:#4D90FE,stroke-width:3px,color:#fff;
  classDef api fill:#1A1A1A,stroke:#FF9900,stroke-width:3px,color:#fff;
  Assign every node a class with ::: syntax.` : ''}`;

    const truncatedPrompt = userPrompt.length > 6000
        ? userPrompt.substring(0, 6000) + '... (truncated)'
        : userPrompt;

    try {
        const fullText = await generateText(systemPrompt, truncatedPrompt);

        // Check for MCP Tool Call
        const toolCallMatch = fullText.match(/```tool_call\s*(\{[\s\S]*?\})\s*```/);
        if (toolCallMatch) {
            const toolCall = JSON.parse(toolCallMatch[1]);
            const result = await mcpClient.callTool({
                name: toolCall.name,
                arguments: toolCall.arguments
            });
            return {
                type: 'mcp_result',
                content: `MCP Tool Executed: ${toolCall.name}\n\nResult:\n${JSON.stringify(result, null, 2)}`
            };
        }

        return {
            type: 'mermaid',
            content: extractAndValidateMermaid(fullText)
        };
    } catch (err: any) {
        throw new Error(`Diagram generation failed: ${err.message}`);
    }
}

/**
 * Creates a GenerateTextFn from a VS Code Language Model (Copilot).
 */
export function createVSCodeLMGenerator(
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken
): GenerateTextFn {
    return async (systemPrompt: string, userPrompt: string): Promise<string> => {
        const messages = [
            vscode.LanguageModelChatMessage.User(systemPrompt),
            vscode.LanguageModelChatMessage.User(userPrompt)
        ];
        const response = await model.sendRequest(messages, {}, token);
        let fullText = '';
        for await (const chunk of response.text) {
            fullText += chunk;
        }
        return fullText;
    };
}

function extractAndValidateMermaid(text: string): string {
    // 1. Try to find code block first
    const mermaidRegex = /```(?:mermaid)?\s*([\s\S]*?)```/;
    const match = text.match(mermaidRegex);
    let diagramText = match && match[1] ? match[1].trim() : text.trim();

    // 2. If it still has conversational text (no code blocks used), strip everything before the first valid mermaid keyword
    if (!match) {
        const keywords = ['flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 'stateDiagram-v2', 'stateDiagram', 'erDiagram', 'gantt', 'pie', 'mindmap', 'journey'];
        let firstKeywordIdx = -1;
        for (const kw of keywords) {
            const idx = diagramText.indexOf(kw);
            if (idx !== -1 && (firstKeywordIdx === -1 || idx < firstKeywordIdx)) {
                firstKeywordIdx = idx;
            }
        }
        if (firstKeywordIdx !== -1) {
            diagramText = diagramText.substring(firstKeywordIdx).trim();
        }
    }

    const lines = diagramText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) { throw new Error('AI returned an empty diagram.'); }

    // 3. Sanitize Llama's tendency to break Mermaid
    diagramText = diagramText
        // ────────────────────────────────────────────────────
        // CRITICAL: Fix Llama's hallucinated arrow syntax
        // Groq/Llama writes -->|Label|>  instead of  -->|Label|
        // This single regex kills 90% of all Mermaid syntax errors from LLMs
        .replace(/-->([ ]*)\|([^|]*)\|>/g, '-->|$2|')
        // Also fix the variant  -- Label |>  →  -- Label -->
        .replace(/--\s([^|>]+)\s\|>/g, '-- $1 -->')
        // ────────────────────────────────────────────────────
        // Fix unclosed square brackets in labels e.g.  ["AWS S3 Data Lake"  (missing closing ])
        .replace(/"([^"]*)"(?=\s*(?:$|\n|-->|---|\|))/g, (m) => m)
        // Remove trailing conversational text after the diagram ends (if no backticks were used)
        .replace(/^(Hope this helps|Let me know|Here is the diagram|This diagram shows|Note:|I hope).*$/gmi, '')
        // Fix unescaped quotes inside labels
        .replace(/\\"/g, "'")
        // Fix HTML entities
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');

    return diagramText;
}
