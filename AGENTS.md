# Diagram Weaver Extension

This project is a VS Code extension called "Diagram Weaver". Its primary function is to generate hand-drawn, minimalist Mermaid diagrams directly from Copilot Chat using native VS Code Language Models (`vscode.lm` API).

## Key Files:
- `src/extension.ts`: The main entry point for the VS Code extension. It handles the extension's activation and registration of commands.
- `src/promptEngine.ts`: Contains the core logic for generating Mermaid syntax. It interacts with the `vscode.lm` API and applies a strict system prompt to ensure hand-drawn, minimalist aesthetics.
- `src/diagramPanel.ts`: Manages the webview panel responsible for rendering the generated Mermaid diagrams using `mermaid.js`.

## Architecture Highlights:
- Utilizes `vscode.lm` API for AI model inference, which offers zero setup friction, no API key requirements, and leverages GitHub/Microsoft for inference costs.
- Implements hand-drawn aesthetics for Mermaid diagrams by combining `look: 'handDrawn'` theme with strict prompting.
- Features a lightweight, regex-based XML builder for Draw.io export without needing Draw.io.
- Supports live Markdown generation to dump architecture diagrams into `ARCHITECTURE.md` using `@diagram /generateDocs`.

## Build and Run:
- Install dependencies: `npm install`
- Compile TypeScript: `npm run compile`
- Run in Extension Development Host: Press `F5` in VS Code.

For more details, refer to the [README.md](README.md) file.
