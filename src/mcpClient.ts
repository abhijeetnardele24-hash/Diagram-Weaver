import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let mcpClient: Client | undefined;
let transport: StdioClientTransport | undefined;

/**
 * Initializes and returns the MCP Client connected to the drawio MCP server.
 */
export async function getMcpClient(): Promise<Client> {
    if (mcpClient) {
        return mcpClient;
    }

    vscode.window.showInformationMessage('Initializing MCP Servers (this may take a moment to download via npx)...');

    transport = new StdioClientTransport({
        command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
        args: ['-y', '@drawio/mcp']
    });

    mcpClient = new Client({
        name: 'diagramweaver-mcp-client',
        version: '1.0.0'
    }, {
        capabilities: {}
    });

    try {
        await mcpClient.connect(transport);
        vscode.window.showInformationMessage('MCP Server connected successfully!');
    } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to connect to MCP Server: ${err.message}`);
        throw err;
    }

    return mcpClient;
}

export async function deactivateMcp() {
    if (transport) {
        await transport.close();
    }
}
