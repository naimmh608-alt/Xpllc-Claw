#!/usr/bin/env node
'use strict';

/**
 * groq-adapt-agents.js
 *
 * Adapt ECC agent frontmatter for Groq API.
 * Maps Claude model aliases (opus/sonnet/haiku) to Groq model IDs,
 * and copies agents into .groq/agents/ for use with the Groq runner.
 *
 * Usage:
 *   node scripts/groq-adapt-agents.js [--agents-dir <dir>] [--out-dir <dir>] [--model-map <json>]
 *
 * Examples:
 *   node scripts/groq-adapt-agents.js
 *   node scripts/groq-adapt-agents.js --agents-dir ./agents --out-dir .groq/agents
 *   node scripts/groq-adapt-agents.js --model-map '{"opus":"deepseek-r1-distill-llama-70b"}'
 */

const fs = require('fs');
const path = require('path');

// Default model alias → Groq model ID
const DEFAULT_MODEL_MAP = {
  opus: 'llama-3.3-70b-versatile',
  sonnet: 'llama-3.1-70b-versatile',
  haiku: 'llama-3.1-8b-instant',
};

// Load from .groq/models.json if it exists
function loadModelConfig(repoRoot) {
  const configPath = path.join(repoRoot, '.groq', 'models.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return config.modelAliases || DEFAULT_MODEL_MAP;
    } catch {
      return DEFAULT_MODEL_MAP;
    }
  }
  return DEFAULT_MODEL_MAP;
}

function usage() {
  return [
    'Adapt ECC agent frontmatter for Groq API.',
    '',
    'Usage:',
    '  node scripts/groq-adapt-agents.js [options]',
    '',
    'Options:',
    '  --agents-dir <dir>   Source agents directory (default: ./agents)',
    '  --out-dir <dir>      Output directory (default: ./.groq/agents)',
    '  --model-map <json>   JSON overrides for model aliases',
    '  --list-models        Show available Groq model mappings',
    '  --dry-run            Show changes without writing files',
    '  -h, --help           Show this help',
    '',
    'Model aliases mapped:',
    '  opus   → llama-3.3-70b-versatile  (complex reasoning)',
    '  sonnet → llama-3.1-70b-versatile  (balanced coding)',
    '  haiku  → llama-3.1-8b-instant     (fast/lightweight)',
  ].join('\n');
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { help: true };
  }

  const options = {
    help: false,
    listModels: false,
    dryRun: false,
    agentsDir: null,
    outDir: null,
    modelMapOverride: {},
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--list-models') {
      options.listModels = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--agents-dir') {
      options.agentsDir = path.resolve(argv[++i]);
    } else if (arg === '--out-dir') {
      options.outDir = path.resolve(argv[++i]);
    } else if (arg === '--model-map') {
      try {
        options.modelMapOverride = JSON.parse(argv[++i]);
      } catch {
        throw new Error('--model-map must be valid JSON. Example: \'{"opus":"deepseek-r1-distill-llama-70b"}\'');
      }
    }
  }

  return options;
}

function stripQuotes(value) {
  return value.trim().replace(/^['""]|['""]$/g, '');
}

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---([\s\S]*)$/);
  if (!match) return null;
  return {
    frontmatterText: match[1],
    body: match[2],
  };
}

function adaptFrontmatter(text, modelMap) {
  const parsed = parseFrontmatter(text);
  if (!parsed) return { text, changed: false, originalModel: null, newModel: null };

  let changed = false;
  let originalModel = null;
  let newModel = null;
  const updatedLines = [];

  for (const line of parsed.frontmatterText.split('\n')) {
    // Adapt model: alias → Groq model ID
    const modelMatch = line.match(/^(\s*model\s*:\s*)(.+)$/);
    if (modelMatch) {
      const alias = stripQuotes(modelMatch[2]).toLowerCase();
      if (modelMap[alias]) {
        originalModel = alias;
        newModel = modelMap[alias];
        updatedLines.push(`${modelMatch[1]}${newModel}`);
        changed = true;
        continue;
      }
      // Already a full model ID (not an alias), keep as-is
      updatedLines.push(line);
      continue;
    }

    updatedLines.push(line);
  }

  if (!changed) return { text, changed: false, originalModel, newModel };

  return {
    text: `---\n${updatedLines.join('\n')}\n---${parsed.body}`,
    changed: true,
    originalModel,
    newModel,
  };
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function adaptAgents(agentsDir, outDir, modelMap, dryRun) {
  if (!fs.existsSync(agentsDir)) {
    throw new Error(`Agents directory not found: ${agentsDir}`);
  }

  if (!dryRun) {
    ensureDir(outDir);
  }

  const results = [];

  for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

    const srcPath = path.join(agentsDir, entry.name);
    const destPath = path.join(outDir, entry.name);
    const original = fs.readFileSync(srcPath, 'utf8');
    const adapted = adaptFrontmatter(original, modelMap);

    results.push({
      file: entry.name,
      changed: adapted.changed,
      originalModel: adapted.originalModel,
      newModel: adapted.newModel,
    });

    if (!dryRun) {
      fs.writeFileSync(destPath, adapted.text, 'utf8');
    }
  }

  return results;
}

function listModels(repoRoot) {
  const configPath = path.join(repoRoot, '.groq', 'models.json');
  if (!fs.existsSync(configPath)) {
    console.log('No .groq/models.json found. Using defaults:');
    for (const [alias, model] of Object.entries(DEFAULT_MODEL_MAP)) {
      console.log(`  ${alias.padEnd(8)} → ${model}`);
    }
    return;
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log('\nModel Aliases:');
  for (const [alias, model] of Object.entries(config.modelAliases || {})) {
    console.log(`  ${alias.padEnd(10)} → ${model}`);
  }

  console.log('\nAvailable Groq Models:');
  for (const [id, info] of Object.entries(config.availableModels || {})) {
    const vision = info.vision ? ' [vision]' : '';
    console.log(`  ${id.padEnd(42)} (${info.tier}, ${info.speed})${vision}`);
    console.log(`  ${''.padEnd(44)}${info.description}`);
  }
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(usage());
    return;
  }

  if (options.listModels) {
    listModels(repoRoot);
    return;
  }

  const agentsDir = options.agentsDir || path.join(repoRoot, 'agents');
  const outDir = options.outDir || path.join(repoRoot, '.groq', 'agents');

  // Merge model maps: defaults < file config < CLI overrides
  const fileModelMap = loadModelConfig(repoRoot);
  const modelMap = { ...DEFAULT_MODEL_MAP, ...fileModelMap, ...options.modelMapOverride };

  console.log(`\nGroq Agent Adapter`);
  console.log(`  Source: ${agentsDir}`);
  console.log(`  Output: ${outDir}`);
  console.log(`  Dry run: ${options.dryRun}`);
  console.log(`  Model mappings: opus→${modelMap.opus}, sonnet→${modelMap.sonnet}, haiku→${modelMap.haiku}\n`);

  const results = adaptAgents(agentsDir, outDir, modelMap, options.dryRun);

  let updated = 0;
  let unchanged = 0;

  for (const r of results) {
    if (r.changed) {
      const tag = options.dryRun ? '[dry-run]' : '[updated]';
      console.log(`  ${tag} ${r.file}: ${r.originalModel} → ${r.newModel}`);
      updated++;
    } else {
      unchanged++;
    }
  }

  console.log(`\n✓ ${updated} agent(s) adapted, ${unchanged} already compatible`);
  if (!options.dryRun && updated > 0) {
    console.log(`✓ Groq agents written to: ${outDir}`);
    console.log(`\nNext: GROQ_API_KEY=<key> node scripts/groq-runner.js --agent <name> --prompt "<task>"`);
  }
}

try {
  main();
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
