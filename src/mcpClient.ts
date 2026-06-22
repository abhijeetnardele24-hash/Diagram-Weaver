import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let mcpClient: Client | undefined;
let transport: StdioClientTransport | undefined;
let mcpFailed = false; // If MCP failed once, skip it entirely for the session

/**
 * Tries to connect to the MCP server with a 5-second timeout.
 * If it fails or times out, returns a dummy no-op client so diagram generation continues.
 */
export async function getMcpClient(): Promise<Client> {
    // If already connected, return cached client
    if (mcpClient) {
        return mcpClient;
    }

    // If MCP failed this session, return a no-op dummy immediately
    if (mcpFailed) {
        return createNoOpClient();
    }

    try {
        transport = new StdioClientTransport({
            command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
            args: ['-y', '@drawio/mcp']
        });

        const client = new Client({
            name: 'diagramweaver-mcp-client',
            version: '1.0.0'
        }, {
            capabilities: {}
        });

        // Race: connect vs 5-second timeout
        await Promise.race([
            client.connect(transport),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('MCP connect timeout')), 5000)
            )
        ]);

        mcpClient = client;
        return mcpClient;
    } catch (err: any) {
        // MCP failed — mark it so we skip it for the rest of the session
        mcpFailed = true;
        console.log(`[Diagram Weaver] MCP unavailable (${err.message}). Continuing without it.`);
        return createNoOpClient();
    }
}

/**
 * A lightweight no-op MCP client stub.
 * Returns empty tool lists so the diagram engine skips MCP tool calls entirely.
 */
function createNoOpClient(): Client {
    return {
        listTools: async () => ({ tools: [] }),
        callTool: async () => ({ content: [] }),
        connect: async () => {},
        close: async () => {},
    } as unknown as Client;
}

export async function deactivateMcp() {
    if (transport) {
        try { await transport.close(); } catch { /* ignore */ }
    }
}
