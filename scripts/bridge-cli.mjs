#!/usr/bin/env node

const SESSION_KEY = process.env.CLAUDE_SESSION_KEY;
const ORG_ID = process.env.CLAUDE_ORG_ID || "f1f8a19a-2cfe-46d4-90ac-7e923275f907";

if (!SESSION_KEY) {
  console.error("CLAUDE_SESSION_KEY env var required");
  process.exit(1);
}

const headers = {
  "content-type": "application/json",
  "cookie": `sessionKey=${SESSION_KEY}`,
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  "anthropic-client-sha": "unknown",
  "anthropic-client-version": "unknown",
};

const BASE = `https://claude.ai/api/organizations/${ORG_ID}`;

async function api(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${BASE}${path}`, { headers, signal: controller.signal });
    if (!res.ok) {
      const text = await res.text();
      console.error(`API ${res.status}: ${text.slice(0, 300)}`);
      process.exit(1);
    }
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "list-projects": {
    const projects = await api("/projects");
    console.log(JSON.stringify(projects.map(p => ({
      id: p.uuid, name: p.name, description: p.description || "",
    })), null, 2));
    break;
  }

  case "get-project": {
    if (!args[0]) { console.error("Usage: bridge-cli.mjs get-project <id>"); process.exit(1); }
    console.log(JSON.stringify(await api(`/projects/${args[0]}`), null, 2));
    break;
  }

  case "list-files": {
    if (!args[0]) { console.error("Usage: bridge-cli.mjs list-files <project-id>"); process.exit(1); }
    const docs = await api(`/projects/${args[0]}/docs`);
    console.log(JSON.stringify(docs.map(d => ({
      id: d.uuid, name: d.file_name, size: d.content?.length || 0,
    })), null, 2));
    break;
  }

  case "get-file": {
    if (!args[0] || !args[1]) { console.error("Usage: bridge-cli.mjs get-file <project-id> <file-id>"); process.exit(1); }
    const doc = await api(`/projects/${args[0]}/docs/${args[1]}`);
    console.log(doc.content || JSON.stringify(doc, null, 2));
    break;
  }

  case "get-instructions": {
    if (!args[0]) { console.error("Usage: bridge-cli.mjs get-instructions <project-id>"); process.exit(1); }
    const project = await api(`/projects/${args[0]}`);
    console.log(project.prompt_template || "(no instructions set)");
    break;
  }

  case "search": {
    if (!args[0]) { console.error("Usage: bridge-cli.mjs search <query>"); process.exit(1); }
    const projects = await api("/projects");
    const q = args[0].toLowerCase();
    const results = projects.filter(p =>
      p.name?.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q)
    ).map(p => ({ id: p.uuid, name: p.name, description: p.description || "" }));
    console.log(JSON.stringify(results, null, 2));
    break;
  }

  case "agent-context": {
    if (!args[0]) { console.error("Usage: bridge-cli.mjs agent-context <project-id>"); process.exit(1); }
    const [project, docs] = await Promise.all([
      api(`/projects/${args[0]}`),
      api(`/projects/${args[0]}/docs`),
    ]);
    console.log(JSON.stringify({
      project: { id: project.uuid, name: project.name, description: project.description },
      instructions: project.prompt_template || null,
      files: docs.map(d => ({ id: d.uuid, name: d.file_name, size: d.content?.length || 0 })),
    }, null, 2));
    break;
  }

  default:
    console.log("Commands: list-projects, get-project, list-files, get-file, get-instructions, search, agent-context");
    console.log("Env: CLAUDE_SESSION_KEY (required), CLAUDE_ORG_ID (optional)");
}
