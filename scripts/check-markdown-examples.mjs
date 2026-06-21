import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "siglume-sdrp-md-"));
const failures = [];

function fail(message) {
  failures.push(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    fail(
      `${command} ${args.join(" ")} failed with status ${result.status}${result.error ? ` (${result.error.message})` : ""}\n${result.stdout || ""}${result.stderr || ""}`.trim(),
    );
  }
}

function walkMarkdown(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkMarkdown(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path.relative(root, fullPath).replaceAll("\\", "/"));
    }
  }
  return files;
}

function examplesFrom(file) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  const pattern =
    /<!--\s*siglume-example:\s*(ts|py)\s+([A-Za-z0-9_-]+)\s*-->\s*```(?:ts|typescript|py|python)\n([\s\S]*?)```/g;
  return [...text.matchAll(pattern)].map((match) => ({
    file,
    language: match[1],
    id: match[2],
    code: match[3],
  }));
}

const markdownFiles = ["README.md", ...walkMarkdown(path.join(root, "docs"))];
const examples = markdownFiles.flatMap(examplesFrom);

if (!examples.length) {
  fail("No siglume-example markdown blocks found.");
}

const tsExamples = examples.filter((example) => example.language === "ts");
if (tsExamples.length) {
  const tsRoot = path.join(tmp, "ts");
  fs.mkdirSync(path.join(tsRoot, "src", "siglume"), { recursive: true });
  fs.mkdirSync(path.join(tsRoot, "database"), { recursive: true });
  fs.copyFileSync(
    path.join(root, "templates", "express", "siglume-sdrp-routes.ts"),
    path.join(tsRoot, "src", "siglume", "siglume-sdrp-routes.ts"),
  );
  fs.copyFileSync(
    path.join(root, "templates", "express", "siglume-order-store.sql.ts"),
    path.join(tsRoot, "src", "siglume", "siglume-order-store.sql.ts"),
  );
  fs.writeFileSync(path.join(tsRoot, "package.json"), JSON.stringify({ type: "module" }, null, 2));
  try {
    fs.symlinkSync(path.join(root, "node_modules"), path.join(tsRoot, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
  }
  fs.writeFileSync(
    path.join(tsRoot, "database", "prisma.ts"),
    [
      "export const prisma: any = {",
      "  order: {",
      "    findUnique: async () => ({ customerId: 'user_123', status: 'created' }),",
      "  },",
      "};",
      "",
    ].join("\n"),
  );

  for (const example of tsExamples) {
    let prelude = "";
    if (example.id === "readme-hosted-checkout") {
      prelude = [
        "const order = { id: 'order_123' };",
        "const paymentAttempt = { number: 1 };",
        "function redirect(_url: string): void {}",
        "",
      ].join("\n");
    }
    fs.writeFileSync(path.join(tsRoot, "src", `${example.id}.ts`), `${prelude}${example.code}`);
  }

  fs.writeFileSync(
    path.join(tsRoot, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          types: ["node"],
          resolveJsonModule: true,
          baseUrl: root.replaceAll("\\", "/"),
          paths: {
            "@siglume/direct-request-payment": ["./src/index.ts"],
          },
        },
        include: [path.join(tsRoot, "src", "**", "*.ts").replaceAll("\\", "/"), "./src/index.ts"],
      },
      null,
      2,
    ),
  );
  run(process.execPath, [path.join(root, "node_modules", "typescript", "bin", "tsc"), "-p", path.join(tsRoot, "tsconfig.json")]);
}

const pyExamples = examples.filter((example) => example.language === "py");
if (pyExamples.length) {
  const pyRoot = path.join(tmp, "pyapp");
  fs.mkdirSync(path.join(pyRoot, "siglume"), { recursive: true });
  fs.cpSync(path.join(root, "templates", "fastapi"), path.join(pyRoot, "siglume"), { recursive: true });
  fs.writeFileSync(path.join(pyRoot, "__init__.py"), "");
  fs.writeFileSync(path.join(pyRoot, "siglume", "__init__.py"), "");
  fs.writeFileSync(
    path.join(pyRoot, "auth.py"),
    "def current_user_id(_request):\n    return 'user_123'\n",
  );
  fs.writeFileSync(
    path.join(pyRoot, "database.py"),
    [
      "class _SessionLocal:",
      "    pass",
      "",
      "SessionLocal = _SessionLocal",
      "",
      "def user_can_pay_order(_session_local, _order_id, _user_id):",
      "    return True",
      "",
    ].join("\n"),
  );

  for (const example of pyExamples) {
    let prelude = "";
    if (example.id === "readme-hosted-checkout") {
      prelude = [
        "order = {'id': 'order_123'}",
        "payment_attempt = {'number': 1}",
        "def redirect(_url):",
        "    return None",
        "",
      ].join("\n");
    }
    fs.writeFileSync(path.join(pyRoot, `${example.id}.py`), `${prelude}${example.code}`);
  }

  const pythonParts = process.env.PYTHON
    ? process.env.PYTHON.split(/\s+/).filter(Boolean)
    : process.platform === "win32"
      ? ["py", "-3.11"]
      : ["python"];
  const [python, ...pythonPrefixArgs] = pythonParts;
  run(python, [...pythonPrefixArgs, "-m", "py_compile", ...pyExamples.map((example) => path.join(pyRoot, `${example.id}.py`))]);
}

fs.rmSync(tmp, { recursive: true, force: true });

if (failures.length) {
  console.error("Markdown example checks failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Markdown example checks passed (${examples.length} examples).`);
