import { existsSync, readFileSync, readdirSync } from "node:fs";

const root = new URL("../", import.meta.url);

function read(relativePath) {
  return readFileSync(new URL(relativePath, root), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const skillNames = ["finn-agent", "finn-build", "finn-review", "finn-spec"];
const skillDirectory = new URL("skills/", root);
const actualSkillNames = readdirSync(skillDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

assert(
  JSON.stringify(actualSkillNames) === JSON.stringify(skillNames),
  `Expected only ${skillNames.join(", ")}; found ${actualSkillNames.join(", ")}`,
);

for (const skillName of skillNames) {
  const relativePath = `skills/${skillName}/SKILL.md`;
  const text = read(relativePath);
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/);

  assert(frontmatter, `${relativePath} is missing YAML frontmatter`);

  const fields = frontmatter[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const name = fields.find((line) => line.startsWith("name: "))?.slice(6);
  const description = fields
    .find((line) => line.startsWith("description: "))
    ?.slice(13);

  assert(fields.length === 2, `${relativePath} must contain only name and description frontmatter`);
  assert(name === skillName, `${relativePath} name must be ${skillName}`);
  assert(description, `${relativePath} needs a description`);

  const installed = text.replace(/\bTEAM\b/g, "ENG");
  assert(!/\bTEAM\b/.test(installed), `${relativePath} left a TEAM placeholder after installation`);
}

const readme = read("README.md");
for (const match of readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
  const target = match[1];
  if (!target.startsWith("http") && !target.startsWith("#")) {
    assert(existsSync(new URL(target, root)), `README link does not exist: ${target}`);
  }
}

const build = read("skills/finn-build/SKILL.md");
const review = read("skills/finn-review/SKILL.md");
const agent = read("skills/finn-agent/SKILL.md");
const requiredContracts = [
  [build.includes("not labeled `blocked`"), "builder must exclude blocked issues"],
  [build.includes("remove `loop-changes-requested`"), "builder escalation must leave the repair queue"],
  [build.includes("defaultBranchRef"), "builder must detect the default branch"],
  [build.includes("git status --porcelain"), "builder must protect dirty worktrees"],
  [review.includes("gh pr checks NUMBER --required"), "reviewer must inspect required checks"],
  [review.includes("Finn-loop review of COMMIT_SHA"), "reviewer must record the reviewed SHA"],
  [readme.includes("/reload-skills"), "installer must reload newly copied skills"],
  [readme.includes("linear.app/docs/github-integration"), "README must explain Linear's GitHub integration"],
  [agent.includes("get_agent_context"), "agent skill must use get_agent_context for bootstrapping"],
  [agent.includes("Never send project knowledge to external services"), "agent skill must enforce knowledge containment"],
];

for (const [condition, message] of requiredContracts) {
  assert(condition, message);
}

assert(!readme.includes("skills/spec/SKILL.md"), "README references the old spec path");
assert(!readme.includes("skills/build/SKILL.md"), "README references the old build path");
assert(!readme.includes("skills/review/SKILL.md"), "README references the old review path");
assert(!build.includes("origin/main"), "builder hardcodes origin/main");

// ── Agent definitions ──

const agentDirectory = new URL(".claude/agents/", root);
const expectedAgents = [
  "knowledge-researcher",
  "project-builder",
  "project-reviewer",
  "project-specialist",
];

if (existsSync(agentDirectory)) {
  const actualAgents = readdirSync(agentDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name.replace(/\.md$/, ""))
    .sort();

  assert(
    JSON.stringify(actualAgents) === JSON.stringify(expectedAgents),
    `Expected agents ${expectedAgents.join(", ")}; found ${actualAgents.join(", ")}`,
  );

  for (const agentName of actualAgents) {
    const relativePath = `.claude/agents/${agentName}.md`;
    const text = read(relativePath);
    const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
    assert(fm, `${relativePath} is missing YAML frontmatter`);

    const agentFields = fm[1].split("\n").map((l) => l.trim()).filter(Boolean);
    const aName = agentFields.find((l) => l.startsWith("name: "))?.slice(6);
    const aDesc = agentFields.find((l) => l.startsWith("description: "))?.slice(13);
    assert(aName === agentName, `${relativePath} name must be ${agentName}`);
    assert(aDesc, `${relativePath} needs a description`);

    assert(
      text.includes("Never expose project knowledge outside the session")
        || text.includes("Never include project knowledge content"),
      `${relativePath} must enforce knowledge containment`,
    );
  }

  console.log(`Validated ${actualAgents.length} agent definitions.`);
}

console.log(`Validated ${skillNames.length} skills, README links, and ${requiredContracts.length} safety contracts.`);
