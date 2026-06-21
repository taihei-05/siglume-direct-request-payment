import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
function walkMarkdown(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".venv", "__pycache__"].includes(entry.name)) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkMarkdown(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path.relative(root, fullPath).replaceAll("\\", "/"));
    }
  }
  return files;
}

const markdownFiles = [
  "README.md",
  ...walkMarkdown(path.join(root, "docs")),
  ...walkMarkdown(path.join(root, "templates")),
  ...walkMarkdown(path.join(root, "examples")),
];

const failures = [];

function fail(message) {
  failures.push(message);
}

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function slugForHeading(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*~[\]()]/g, "")
    .replace(/[!"#$%&'+,./:;<=>?@\\^{}|]/g, "")
    .replace(/\s+/g, "-");
}

function headingSlugs(file) {
  const slugs = new Set();
  for (const line of read(file).split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match) {
      slugs.add(slugForHeading(match[2]));
    }
  }
  return slugs;
}

function checkLinks() {
  const headings = new Map(markdownFiles.map((file) => [file, headingSlugs(file)]));
  const linkPattern = /!?\[[^\]]*]\(([^)]+)\)/g;
  for (const file of markdownFiles) {
    const text = read(file);
    for (const match of text.matchAll(linkPattern)) {
      const raw = match[1].trim();
      if (!raw || raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("mailto:")) {
        continue;
      }
      const [targetPathRaw, anchorRaw] = raw.split("#");
      const resolved = targetPathRaw
        ? path.normalize(path.join(path.dirname(file), decodeURIComponent(targetPathRaw))).replaceAll("\\", "/")
        : file;
      const absolute = path.join(root, resolved);
      if (!fs.existsSync(absolute)) {
        fail(`${file}: broken relative link: ${raw}`);
        continue;
      }
      if (anchorRaw && resolved.endsWith(".md")) {
        const anchor = decodeURIComponent(anchorRaw).toLowerCase();
        const slugs = headings.get(resolved) ?? headingSlugs(resolved);
        if (!slugs.has(anchor)) {
          fail(`${file}: broken anchor ${raw}`);
        }
      }
    }
  }
}

function checkInvariants() {
  const allDocs = markdownFiles.map((file) => `${file}\n${read(file)}`).join("\n");
  for (const banned of [
    "can close that batch early",
    "can close early once",
    "Siglume can close",
    "10-Minute Product Integration",
    "minimum safe Siglume Direct Request Payment flow",
  ]) {
    if (allDocs.includes(banned)) {
      fail(`banned documentation phrase remains: ${banned}`);
    }
  }

  const readme = read("README.md");
  if (!/^## Current Public Beta Scope$/m.test(readme)) {
    fail("README.md must expose ## Current Public Beta Scope for its Start Here anchor.");
  }
  if (/Contact integration support.*request_id.*trace_id/s.test(readme)) {
    fail("README.md must not ask users to post request_id / trace_id in public issues.");
  }

  const apiReference = read("docs/api-reference.md");
  for (const envName of [
    "SIGLUME_DIRECT_PAYMENT_MERCHANT",
    "SHOP_PUBLIC_ORIGIN",
    "SHOP_WEBHOOK_URL",
    "SIGLUME_DIRECT_PAYMENT_TEST_CURRENCY",
    "SIGLUME_DIRECT_PAYMENT_TEST_AMOUNT_MINOR",
  ]) {
    if (!apiReference.includes(`\`${envName}\``)) {
      fail(`docs/api-reference.md is missing environment variable ${envName}`);
    }
  }

  const quickstart = read("docs/quickstart-10-minutes.md");
  for (const expected of [
    "# 10-Minute Standard Checkout Integration",
    "import { prisma } from \"../database/prisma.js\";",
    "## 10. 10-Minute Sandbox Complete",
    "## 11. Live Go-Live Complete",
    "createSiglumeSdrpSqlSchema({",
    "order_sdrp_sandbox_001",
    "authorization: Bearer <product-test-user-token>",
    "durable claim,",
  ]) {
    if (!quickstart.includes(expected)) {
      fail(`docs/quickstart-10-minutes.md is missing: ${expected}`);
    }
  }

  for (const templateReadme of ["templates/express/README.md", "templates/fastapi/README.md"]) {
    const templateText = read(templateReadme);
    for (const expected of ["authorize_order", "Do not run a production checkout route without `authorize_order`"]) {
      if (!templateText.includes(expected)) {
        fail(`${templateReadme} is missing production order authorization guidance: ${expected}`);
      }
    }
  }

  const pricing = read("docs/pricing.md");
  if (!/`accrued_provider_gross_minor`\s+is the\s+active-batch sum/s.test(pricing)) {
    fail("docs/pricing.md must define accrued_provider_gross_minor as a calculation name.");
  }
}

checkLinks();
checkInvariants();

if (failures.length) {
  console.error("Documentation checks failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Documentation checks passed (${markdownFiles.length} markdown files).`);
