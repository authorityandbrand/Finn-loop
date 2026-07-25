import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// claude.ai Projects store knowledge in GCS at gs://claude-kb-projects/{project_id}/
// Access is authenticated via the claude.ai session key (sk-ant-sid01-...)
// No platform API key needed — the session key from a logged-in user is sufficient.

const CLAUDE_API = "https://claude.ai/api";

interface Env {
  CLAUDE_SESSION_KEY?: string;
  ORG_ID?: string;
}

// Resolve auth: session key from request header, env, or claude.ai connector flow
function resolveSessionKey(request: Request, env: Env): string {
  const fromHeader = request.headers.get("x-session-key")
    || request.headers.get("cookie")?.match(/sessionKey=([^;]+)/)?.[1];

  const key = fromHeader || env.CLAUDE_SESSION_KEY;
  if (!key) {
    throw new Error(
      "No session key available. Provide x-session-key header or set CLAUDE_SESSION_KEY secret. "
      + "In a logged-in claude.ai connector, the session flows automatically."
    );
  }
  return key;
}

function resolveOrgId(request: Request, env: Env): string {
  const fromHeader = request.headers.get("x-org-id");
  const id = fromHeader || env.ORG_ID;
  if (!id) {
    throw new Error("No org ID available. Provide x-org-id header or set ORG_ID env var.");
  }
  return id;
}

async function claudeApiFetch(
  path: string,
  sessionKey: string,
  method = "GET",
  body?: unknown
): Promise<unknown> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "cookie": `sessionKey=${sessionKey}`,
    "anthropic-client-sha": "unknown",
    "anthropic-client-version": "unknown",
  };

  const res = await fetch(`${CLAUDE_API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`claude.ai API ${res.status}: ${text}`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  return res.text();
}

function createServer(sessionKey: string, orgId: string) {
  const server = new McpServer({
    name: "project-bridge",
    version: "2.0.0",
  });

  // ── Projects ──

  server.tool(
    "list_projects",
    "List all claude.ai Projects accessible to this organization.",
    {},
    async () => {
      const data = await claudeApiFetch(
        `/organizations/${orgId}/projects`,
        sessionKey
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "get_project",
    "Get details of a specific claude.ai Project.",
    {
      project_id: z.string().describe("The project UUID"),
    },
    async ({ project_id }) => {
      const data = await claudeApiFetch(
        `/organizations/${orgId}/projects/${project_id}`,
        sessionKey
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // ── Project Knowledge (GCS-backed files) ──

  server.tool(
    "list_project_files",
    "List all knowledge files in a claude.ai Project. Files are stored in GCS at gs://claude-kb-projects/{project_id}/.",
    {
      project_id: z.string().describe("The project UUID"),
    },
    async ({ project_id }) => {
      const data = await claudeApiFetch(
        `/organizations/${orgId}/projects/${project_id}/docs`,
        sessionKey
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "get_project_file",
    "Get the content of a specific knowledge file from a claude.ai Project.",
    {
      project_id: z.string().describe("The project UUID"),
      file_id: z.string().describe("The file/document UUID"),
    },
    async ({ project_id, file_id }) => {
      const data = await claudeApiFetch(
        `/organizations/${orgId}/projects/${project_id}/docs/${file_id}`,
        sessionKey
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // ── Project Instructions ──

  server.tool(
    "get_project_instructions",
    "Get the custom instructions configured for a claude.ai Project.",
    {
      project_id: z.string().describe("The project UUID"),
    },
    async ({ project_id }) => {
      // Project details include the instructions/prompt field
      const data = await claudeApiFetch(
        `/organizations/${orgId}/projects/${project_id}`,
        sessionKey
      ) as Record<string, unknown>;

      const instructions = data?.prompt_template
        || data?.custom_instructions
        || data?.description
        || "No instructions found in project response";

      return {
        content: [{ type: "text", text: typeof instructions === "string" ? instructions : JSON.stringify(instructions, null, 2) }],
      };
    }
  );

  // ── Cross-project search ──

  server.tool(
    "search_project_knowledge",
    "Search across knowledge files in a specific project.",
    {
      project_id: z.string().describe("The project UUID"),
      query: z.string().describe("Search query"),
    },
    async ({ project_id, query }) => {
      // Use the project knowledge search endpoint
      const data = await claudeApiFetch(
        `/organizations/${orgId}/projects/${project_id}/docs/search?q=${encodeURIComponent(query)}`,
        sessionKey
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // ── MCP Resources ──

  server.resource(
    "projects-list",
    "claude://projects",
    { description: "All claude.ai Projects in this organization" },
    async () => {
      const data = await claudeApiFetch(
        `/organizations/${orgId}/projects`,
        sessionKey
      );
      return {
        contents: [{
          uri: "claude://projects",
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
      return new Response(JSON.stringify({
        status: "ok",
        server: "project-bridge",
        version: "2.0.0",
        storage: "gs://claude-kb-projects/{project_id}/",
        auth: "claude.ai session key",
      }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
      try {
        const sessionKey = resolveSessionKey(request, env);
        const orgId = resolveOrgId(request, env);
        const server = createServer(sessionKey, orgId);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        await server.connect(transport);
        return transport.handleRequest(request);
      } catch (err) {
        return new Response(JSON.stringify({
          error: err instanceof Error ? err.message : "Unknown error",
        }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
    }

    return new Response("Not found", { status: 404 });
  },
};
