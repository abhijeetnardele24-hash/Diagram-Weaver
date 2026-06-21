# Diagram Weaver 🕸️

**Diagram Weaver** is a hyper-intelligent, zero-API, offline-capable architecture diagram generator built directly into Visual Studio Code. It leverages your existing VS Code Language Models to weave stunning, enterprise-grade architecture diagrams from text prompts or by automatically scanning your local project directory.

## 🚀 Features

### 1. The Zero-Prompt "Auto-Architect" Engine
Tired of typing out massive prompts explaining your project? Use the **Auto-Scan** feature! 
Diagram Weaver will deep-scan your workspace, physically read your `package.json` and dependency trees, and automatically generate a massive, high-level architecture diagram of your local project without you typing a single word.

### 2. Beautiful Native Rendering Engines
We engineered a custom rendering pipeline that completely bypasses default Mermaid styling. Choose your aesthetic:
*   **Eraser.io Style (Beautiful Modern)**: A gorgeous dark-mode (`#0A0A0A`) infinite canvas with floating nodes, custom drop shadows, ELK-based semantic layout routing, and neon pink/blue borders.
*   **Draw.io (Advanced)**: Connects natively to the `@drawio/mcp` server to mathematically generate raw `.drawio` XML files for strict, enterprise-grade orthogonal grid layouts.
*   **Mermaid Classic**: Standard, fast flowcharts for simple ideas.

### 3. Smart Model Selection
No API Keys required! Diagram Weaver hooks directly into your native VS Code Copilot/Language Model API. It runs a proprietary scoring algorithm to automatically rank your available models (prioritizing `GPT-4`, `o1`, and `Claude 3.5`) ensuring you get max-level reasoning for complex diagrams, while safely falling back to lower-tier models if you run out of credits.

### 4. Interactive Export UI
Diagram Weaver renders inside a native VS Code WebView with a premium SaaS-style toolbar.
*   **Export PNG**: Renders a massive, ultra-high-definition PNG with a perfectly preserved dark-mode background.
*   **Export SVG**: Generates a mathematically preserved SVG with hardcoded background filters so it looks perfect in any browser.

## 🛠️ Usage

1. Open the VS Code Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`).
2. Run **`Diagram Weaver: Weave Diagram (Project Auto-Scan or Custom Prompt)`**.
3. Select whether you want to **Auto-Scan the Current Project** or **Write a Custom Prompt**.
4. Select your rendering engine (e.g., `Eraser.io Style`).
5. Watch the architecture weave itself before your eyes!

## ⚙️ Requirements
* Visual Studio Code (v1.93.0 or higher)
* Active access to VS Code Language Models (e.g., GitHub Copilot Chat).

## 📄 License
This project is licensed under the MIT License.
