#!/usr/bin/env node

const SESSION_KEY = process.env.CLAUDE_SESSION_KEY;
const ORG_ID = process.env.CLAUDE_ORG_ID;

if (!ORG_ID) {
  console.error("CLAUDE_ORG_ID env var required");
  process.exit(1);
}

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

async function api(path, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`${BASE}${path}`, { headers, ...opts, signal: controller.signal });
    if (opts.method === "DELETE" && (res.status === 204 || res.status === 200)) {
      return { ok: true };
    }
    if (!res.ok) {
      const text = await res.text();
      console.error(`API ${res.status}: ${text.slice(0, 300)}`);
      process.exit(1);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : { ok: true };
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

  case "create-file": {
    if (!args[0] || !args[1]) { console.error("Usage: bridge-cli.mjs create-file <project-id> <filename> [content from stdin]"); process.exit(1); }
    let content = args.slice(2).join(" ");
    if (!content) {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      content = Buffer.concat(chunks).toString();
    }
    const result = await api(`/projects/${args[0]}/docs`, {
      method: "POST",
      body: JSON.stringify({ file_name: args[1], content }),
    });
    console.log(JSON.stringify({ id: result.uuid, name: result.file_name }, null, 2));
    break;
  }

  case "update-file": {
    if (!args[0] || !args[1]) { console.error("Usage: bridge-cli.mjs update-file <project-id> <file-id> [content from stdin]"); process.exit(1); }
    let content = args.slice(2).join(" ");
    if (!content) {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      content = Buffer.concat(chunks).toString();
    }
    await api(`/projects/${args[0]}/docs/${args[1]}`, { method: "DELETE" });
    const doc = await api(`/projects/${args[0]}/docs/${args[1]}`).catch(() => null);
    const result = await api(`/projects/${args[0]}/docs`, {
      method: "POST",
      body: JSON.stringify({ file_name: args[1], content }),
    });
    console.log(JSON.stringify({ id: result.uuid, name: result.file_name, updated: true }, null, 2));
    break;
  }

  case "delete-file": {
    if (!args[0] || !args[1]) { console.error("Usage: bridge-cli.mjs delete-file <project-id> <file-id>"); process.exit(1); }
    await api(`/projects/${args[0]}/docs/${args[1]}`, { method: "DELETE" });
    console.log("Deleted");
    break;
  }

  case "delete-project": {
    if (!args[0]) { console.error("Usage: bridge-cli.mjs delete-project <project-id>"); process.exit(1); }
    await api(`/projects/${args[0]}`, { method: "DELETE" });
    console.log("Deleted");
    break;
  }

  case "set-instructions": {
    if (!args[0]) { console.error("Usage: bridge-cli.mjs set-instructions <project-id> [instructions from stdin]"); process.exit(1); }
    let content = args.slice(1).join(" ");
    if (!content) {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      content = Buffer.concat(chunks).toString();
    }
    await api(`/projects/${args[0]}`, {
      method: "PUT",
      body: JSON.stringify({ prompt_template: content }),
    });
    console.log("Instructions updated");
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

  case "list-conversations": {
    if (!args[0]) { console.error("Usage: bridge-cli.mjs list-conversations <project-id>"); process.exit(1); }
    const convos = await api(`/projects/${args[0]}/conversations`);
    console.log(JSON.stringify((convos || []).map(c => ({
      id: c.uuid, name: c.name || "(untitled)", updated: c.updated_at,
      message_count: c.message_count || 0,
    })), null, 2));
    break;
  }

  case "get-conversation": {
    if (!args[0]) { console.error("Usage: bridge-cli.mjs get-conversation <conversation-id>"); process.exit(1); }
    const convo = await api(`/chat_conversations/${args[0]}`);
    const msgs = (convo.chat_messages || []).map(m => {
      // Message text lives directly on m.text (a plain string), not nested in
      // a content-blocks array. The old code looked for `m.content` (array of
      // {type,text} blocks) which does not exist on this endpoint's response
      // shape, so it silently produced an empty string for every message.
      const text = typeof m.text === "string" ? m.text : (m.content || []).filter(c => c.type === "text").map(c => c.text).join("\n");
      return { role: m.sender, text: text.slice(0, 500) };
    });
    console.log(JSON.stringify({
      id: convo.uuid, name: convo.name || "(untitled)",
      project: convo.project_uuid, created: convo.created_at, updated: convo.updated_at,
      message_count: msgs.length,
      messages: msgs,
    }, null, 2));
    break;
  }

  case "delete-conversation": {
    if (!args[0]) { console.error("Usage: bridge-cli.mjs delete-conversation <conversation-id>"); process.exit(1); }
    await api(`/chat_conversations/${args[0]}`, { method: "DELETE" });
    console.log("Deleted");
    break;
  }

  case "list-all-conversations": {
    const projects = await api("/projects");
    const all = [];
    for (const p of projects) {
      try {
        const convos = await api(`/projects/${p.uuid}/conversations`);
        for (const c of (convos || [])) {
          all.push({
            id: c.uuid, name: c.name || "(untitled)",
            project: p.name, project_id: p.uuid,
            updated: c.updated_at, message_count: c.message_count || 0,
          });
        }
      } catch {}
    }
    console.log(JSON.stringify(all, null, 2));
    break;
  }

  default:
    console.log("Read:    list-projects, get-project, list-files, get-file, get-instructions, search, agent-context");
    console.log("Write:   create-file, update-file, delete-file, set-instructions, delete-project");
    console.log("Context: list-conversations, get-conversation, delete-conversation, list-all-conversations");
    console.log("Env: CLAUDE_SESSION_KEY (required), CLAUDE_ORG_ID (optional)");
}
