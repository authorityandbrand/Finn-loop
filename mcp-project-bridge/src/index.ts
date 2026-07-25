import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const ANTHROPIC_API = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const SKILLS_BETA = "skills-2025-10-02";
const FILES_BETA = "files-api-2025-04-14";

interface Env {
  ANTHROPIC_API_KEY?: string;
}

// Resolve auth: prefer session token from request header, fall back to env API key
function resolveAuth(request: Request, env: Env): { header: string; value: string } {
  const sessionToken = request.headers.get("x-session-token")
    || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (sessionToken) {
    return { header: "authorization", value: `Bearer ${sessionToken}` };
  }
  if (env.ANTHROPIC_API_KEY) {
    return { header: "x-api-key", value: env.ANTHROPIC_API_KEY };
  }
  throw new Error("No authentication available. Provide x-session-token header or set ANTHROPIC_API_KEY secret.");
}

async function anthropicFetch(
  path: string,
  auth: { header: string; value: string },
  beta: string,
  params?: Record<string, string>
) {
  const url = new URL(`${ANTHROPIC_API}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), {
    headers: {
      [auth.header]: auth.value,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-beta": beta,
      "content-type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${body}`);
  }
  return res.json();
}

function createServer(auth: { header: string; value: string }) {
  const server = new McpServer({
    name: "project-bridge",
    version: "1.0.0",
  });

  // ── Skills (Project instructions/custom prompts) ──

  server.tool(
    "list_skills",
    "List all skills from your claude.ai account. Filter by source: 'custom' (user-created) or 'anthropic' (built-in).",
    {
      source: z.enum(["custom", "anthropic"]).optional().describe("Filter by skill source"),
      limit: z.number().min(1).max(100).optional().describe("Results per page (default 20)"),
    },
    async ({ source, limit }) => {
      const params: Record<string, string> = {};
      if (source) params.source = source;
      if (limit) params.limit = String(limit);

      const data = await anthropicFetch("/v1/skills", auth, SKILLS_BETA, params);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "get_skill",
    "Get details of a specific skill by ID, including its version and metadata.",
    {
      skill_id: z.string().describe("The skill ID (e.g. skill_01J...)"),
    },
    async ({ skill_id }) => {
      const data = await anthropicFetch(`/v1/skills/${skill_id}`, auth, SKILLS_BETA);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // ── Files (Project knowledge) ──

  server.tool(
    "list_files",
    "List files uploaded to your Anthropic account. These represent project knowledge documents.",
    {
      limit: z.number().min(1).max(1000).optional().describe("Results per page (default 20)"),
      scope_id: z.string().optional().describe("Filter by scope (e.g. session ID)"),
    },
    async ({ limit, scope_id }) => {
      const params: Record<string, string> = {};
      if (limit) params.limit = String(limit);
      if (scope_id) params.scope_id = scope_id;

      const data = await anthropicFetch("/v1/files", auth, FILES_BETA, params);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "get_file_metadata",
    "Get metadata for a specific file by ID.",
    {
      file_id: z.string().describe("The file ID (e.g. file_011C...)"),
    },
    async ({ file_id }) => {
      const data = await anthropicFetch(`/v1/files/${file_id}`, auth, FILES_BETA);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "download_file",
    "Download the content of a file by ID. Only works for files marked as downloadable.",
    {
      file_id: z.string().describe("The file ID to download"),
    },
    async ({ file_id }) => {
      const url = `${ANTHROPIC_API}/v1/files/${file_id}/content`;
      const res = await fetch(url, {
        headers: {
          [auth.header]: auth.value,
          "anthropic-version": ANTHROPIC_VERSION,
          "anthropic-beta": FILES_BETA,
        },
      });
      if (!res.ok) {
        return {
          content: [{ type: "text", text: `Download failed: ${res.status} ${await res.text()}` }],
          isError: true,
        };
      }
      const text = await res.text();
      return {
        content: [{ type: "text", text }],
      };
    }
  );

  // ── MCP Resources (expose files as browsable resources) ──

  server.resource(
    "skills-list",
    "anthropic://skills",
    { description: "All custom skills from your claude.ai account" },
    async () => {
      const data = await anthropicFetch("/v1/skills", auth, SKILLS_BETA, { source: "custom", limit: "100" });
      return {
        contents: [{
          uri: "anthropic://skills",
          mimeType: "application/json",
          text: JSON.stringify(data, null, 2),
        }],
      };
    }
  );

  server.resource(
    "files-list",
    "anthropic://files",
    { description: "All uploaded files/knowledge documents" },
    async () => {
      const data = await anthropicFetch("/v1/files", auth, FILES_BETA, { limit: "100" });
      return {
        contents: [{
          uri: "anthropic://files",
          mimeType: "application/json",
          text: JSON.stringify(data, null, 2),
        }],
      };
    }
  );

  return server;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", server: "project-bridge" }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
      const auth = resolveAuth(request, env);
      const server = createServer(auth);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      return transport.handleRequest(request);
    }

    return new Response("Not found", { status: 404 });
  },
};
