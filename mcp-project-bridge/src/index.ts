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

function extractInstructions(data: Record<string, unknown>): string | null {
  const raw = data?.prompt_template
    ?? data?.custom_instructions
    ?? data?.description
    ?? null;
  if (raw === null) return null;
  return typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
}

function createServer(sessionKey: string, orgId: string) {
  const server = new McpServer({
    name: "project-bridge",
    version: "3.0.0",
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
      const data = await claudeApiFetch(
        `/organizations/${orgId}/projects/${project_id}`,
        sessionKey
      ) as Record<string, unknown>;

      const instructions = extractInstructions(data)
        || "No instructions found in project response";

      return {
        content: [{ type: "text", text: instructions }],
      };
    }
  );

  server.tool(
    "update_project_instructions",
    "Update the custom instructions for a claude.ai Project.",
    {
      project_id: z.string().describe("The project UUID"),
      instructions: z.string().describe("The new instructions text"),
    },
    async ({ project_id, instructions }) => {
      const data = await claudeApiFetch(
        `/organizations/${orgId}/projects/${project_id}`,
        sessionKey,
        "PUT",
        { prompt_template: instructions }
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
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
      const data = await claudeApiFetch(
        `/organizations/${orgId}/projects/${project_id}/docs/search?q=${encodeURIComponent(query)}`,
        sessionKey
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // ── Agent Context ──

  server.tool(
    "get_agent_context",
    "Batch-load a project's instructions and file manifest for agent bootstrapping. Returns everything an agent needs to specialize on a project domain in one call.",
    {
      project_id: z.string().describe("The project UUID"),
      include_file_contents: z.boolean().optional().describe(
        "If true, also fetch the content of each file (capped at 50). Expensive — only use when the agent needs deep knowledge upfront. Default false."
      ),
    },
    async ({ project_id, include_file_contents }) => {
      const [project, files] = await Promise.all([
        claudeApiFetch(
          `/organizations/${orgId}/projects/${project_id}`,
          sessionKey
        ) as Promise<Record<string, unknown>>,
        claudeApiFetch(
          `/organizations/${orgId}/projects/${project_id}/docs`,
          sessionKey
        ) as Promise<unknown>,
      ]);

      const fileList = Array.isArray(files) ? files : [];

      const context: Record<string, unknown> = {
        project_id,
        name: project?.name,
        instructions: extractInstructions(project),
        files: fileList.map((f: Record<string, unknown>) => ({
          id: f.uuid ?? f.id,
          name: f.file_name ?? f.name ?? f.title,
          type: f.content_type ?? f.type,
          created: f.created_at,
        })),
        file_count: fileList.length,
      };

      if (include_file_contents) {
        const batch = fileList.slice(0, 50);
        const loaded = await Promise.all(
          batch.map(async (f: Record<string, unknown>) => {
            const fid = (f.uuid ?? f.id) as string;
            try {
              const content = await claudeApiFetch(
                `/organizations/${orgId}/projects/${project_id}/docs/${fid}`,
                sessionKey
              );
              return { id: fid, name: f.file_name ?? f.name, content };
            } catch {
              return { id: fid, name: f.file_name ?? f.name, error: "failed to load" };
            }
          })
        );
        context.file_contents = loaded;
        if (fileList.length > 50) {
          context.truncated = true;
          context.total_files = fileList.length;
        }
      }

      return {
        content: [{ type: "text", text: JSON.stringify(context, null, 2) }],
      };
    }
  );

  // ── Project Mutations ──

  server.tool(
    "create_project_file",
    "Upload a new knowledge file to a claude.ai Project.",
    {
      project_id: z.string().describe("The project UUID"),
      file_name: z.string().describe("Name for the file"),
      content: z.string().describe("File content (text)"),
    },
    async ({ project_id, file_name, content }) => {
      const data = await claudeApiFetch(
        `/organizations/${orgId}/projects/${project_id}/docs`,
        sessionKey,
        "POST",
        { file_name, content }
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "delete_project_file",
    "Delete a knowledge file from a claude.ai Project.",
    {
      project_id: z.string().describe("The project UUID"),
      file_id: z.string().describe("The file/document UUID to delete"),
    },
    async ({ project_id, file_id }) => {
      const data = await claudeApiFetch(
        `/organizations/${orgId}/projects/${project_id}/docs/${file_id}`,
        sessionKey,
        "DELETE"
      );
      return {
        content: [{ type: "text", text: data ? JSON.stringify(data, null, 2) : "Deleted" }],
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
        version: "3.0.0",
        storage: "gs://claude-kb-projects/{project_id}/",
        auth: "claude.ai session key",
        tools: [
          "list_projects", "get_project",
          "list_project_files", "get_project_file",
          "get_project_instructions", "update_project_instructions",
          "search_project_knowledge", "get_agent_context",
          "create_project_file", "delete_project_file",
        ],
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
