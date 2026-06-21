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
 * Handles intent classification, MCP tools, and Mermaid generation using the provided IDE model.
 */
export async function generateDiagramFromPrompt(
    model: vscode.LanguageModelChat,
    userPrompt: string,
    token: vscode.CancellationToken,
    diagramStyle?: string
): Promise<DiagramResult> {
    
    const mcpClient = await getMcpClient();
    const mcpToolsResponse = await mcpClient.listTools();
    const mcpTools = mcpToolsResponse.tools || [];

    const isEraser = diagramStyle?.includes('Eraser');
    const systemPrompt = `You are an elite, top-tier Diagram Architect.
You have access to MCP (Model Context Protocol) tools.
Available tools: ${JSON.stringify(mcpTools)}

Your task is to take the user's request and fulfill it flawlessly.
If the user asks for a draw.io diagram or an MCP tool, output EXACTLY a JSON tool call block like this:
\`\`\`tool_call
{"name": "tool_name", "arguments": { "key": "value" }}
\`\`\`

If they do not ask for MCP tools, output ONLY a <reasoning> block followed by a single \`\`\`mermaid ... \`\`\` fenced code block.

HIGH-CLASS REASONING ALGORITHM:
Before writing code, you MUST think step-by-step:
1. Identify all core actors/components.
2. Track which variables are currently active.
3. Determine the exact syntax you need before outputting it.
4. Verify there are no typos (like 'deactivate F' instead of 'deactivate FC').

BULLETPROOF FAILSAFE RULES (MANDATORY FOR ALL MODELS):
- NEVER use unescaped quotes or HTML characters inside node labels.
- If you are mapping a massive project directory, DO NOT draw every single file. Abstract them! Only draw the TOP 10-15 most critical architectural components (e.g., 'Backend API', 'Database', 'Frontend Service') to prevent syntax overflow.
- ALWAYS close your brackets and parenthesis perfectly.

CRITICAL MERMAID SYNTAX RULES (FAILURE IS NOT AN OPTION):
1. ANY node label containing spaces, parentheses (), brackets [], braces {}, quotes, or punctuation MUST be enclosed in double quotes.
   - FATAL ERROR: A[Check Temp (90C)] 
   - CORRECT: A["Check Temp (90C)"]
   - FATAL ERROR: B{Label [X]}
   - CORRECT: B{"Label [X]"}
2. Node IDs MUST be purely alphanumeric with NO spaces (e.g., NodeA, StartProcess).
3. Subgraph IDs MUST be purely alphanumeric (e.g., subgraph Sub1 ["User Input"]).
4. NEVER use escaped double quotes (\\") inside a label. Use single quotes instead if needed.
   - FATAL ERROR: C["Clean (\\"Code Red\\")"]
   - CORRECT: C["Clean ('Code Red')"]
${isEraser ? `
ERASER.IO AESTHETIC RULES (MANDATORY):
You are generating a Mermaid diagram that will be heavily styled via CSS to look exactly like Eraser.io.
1. ALWAYS use 'flowchart TD' or 'flowchart LR' (never graph).
2. Space out your logic! Use subgraphs generously to group logical components.
3. Keep labels short, punchy, and highly readable.
4. YOU MUST include these exact classDef lines right below your flowchart declaration:
   classDef compute fill:#1A1A1A,stroke:#FF4D82,stroke-width:3px,color:#fff,rx:8px,ry:8px;
   classDef db fill:#1A1A1A,stroke:#4D90FE,stroke-width:3px,color:#fff,rx:8px,ry:8px;
   classDef api fill:#1A1A1A,stroke:#FF9900,stroke-width:3px,color:#fff,rx:8px,ry:8px;
   classDef default fill:#1A1A1A,stroke:#A1A1AA,stroke-width:3px,color:#fff,rx:8px,ry:8px;
5. Assign EVERY node to one of these classes using the ::: syntax (e.g., A[AWS Lambda]:::compute, B[(PostgreSQL)]:::db, C[Stripe API]:::api).
` : ''}
Example of flawless, complex syntax:
<reasoning>
1. Nodes: Start1, Check1, Err1, Grind1
2. Activations: None needed for flowchart
3. Labels: "Contains [@] or (%)?" needs quotes.
</reasoning>
\`\`\`mermaid
flowchart TD
    Start1["User Command: Make it strong!"] --> Check1{"Contains [@] or (%)?"}
    subgraph Logic ["Brewing Engine"]
        Check1 -->|Yes| Err1["Trigger 'Validation Error'"]
        Check1 -->|No| Grind1["Grind Phase"]
    end
\`\`\``;

    const truncatedPrompt = userPrompt.length > 6000 ? userPrompt.substring(0, 6000) + '... (truncated)' : userPrompt;

    const messages = [
        vscode.LanguageModelChatMessage.User(systemPrompt),
        vscode.LanguageModelChatMessage.User(truncatedPrompt)
    ];

    try {
        const response = await model.sendRequest(messages, {}, token);
        let fullText = '';
        for await (const chunk of response.text) {
            fullText += chunk;
        }

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
        throw new Error(`Model request failed: ${err.message}`);
    }
}

function extractAndValidateMermaid(text: string): string {
    const mermaidRegex = /```(?:mermaid)?\s*([\s\S]*?)```/;
    const match = text.match(mermaidRegex);
    let diagramText = match && match[1] ? match[1].trim() : text.trim();

    const lines = diagramText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) throw new Error('AI returned an empty diagram.');

    const firstWord = lines[0].split(' ')[0];
    const isValid = SUPPORTED_TYPES.some(t => firstWord.startsWith(t)) || firstWord === 'graph' || firstWord === 'stateDiagram';
    
    if (!isValid) {
        throw new Error(`Invalid Mermaid syntax type: '${firstWord}'.`);
    }

    // Backend Sanitization: Mermaid's parser crashes on escaped double quotes inside labels.
    // We automatically convert \" to a single quote to guarantee it renders.
    diagramText = diagramText.replace(/\\"/g, "'");

    return diagramText;
}
