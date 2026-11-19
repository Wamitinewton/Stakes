// Forge bundles only JavaScript, so the prompts written as Markdown under prompts/llm are
// compiled into a TypeScript module the functions can import. Run after editing a
// prompt; a test fails if the two drift apart.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../prompts/llm/', import.meta.url));
const out = fileURLToPath(new URL('../src/services/promptText.ts', import.meta.url));

export function renderPromptModule(files) {
  const entries = Object.keys(files)
    .sort()
    .map((name) => `  ${JSON.stringify(name)}: ${JSON.stringify(files[name].trim())},`)
    .join('\n');
  return `// Generated from prompts/llm/*.md by scripts/build-prompts.mjs. Edit the Markdown, then run\n// \`npm run prompts -w apps/stakes\`.\nexport const PROMPT_TEXT = {\n${entries}\n} as const;\n`;
}

export function readPromptFiles() {
  return Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => [f.slice(0, -3), readFileSync(dir + f, 'utf8')]),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(out, renderPromptModule(readPromptFiles()));
  console.log('wrote', out);
}
