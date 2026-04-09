#!/usr/bin/env node
'use strict';

/**
 * groq-runner.js
 *
 * Run any ECC agent using the Groq API (OpenAI-compatible endpoint).
 * Supports all 47 agents with auto bug-fixing, code review, planning,
 * TDD, security scanning, and more — powered by ultra-fast Groq inference.
 *
 * Usage:
 *   GROQ_API_KEY=<key> node scripts/groq-runner.js --agent <name> --prompt "<task>"
 *   GROQ_API_KEY=<key> node scripts/groq-runner.js --agent code-reviewer --file src/index.ts
 *   GROQ_API_KEY=<key> node scripts/groq-runner.js --agent build-error-resolver --stdin
 *   GROQ_API_KEY=<key> node scripts/groq-runner.js --list
 *
 * Environment Variables:
 *   GROQ_API_KEY          Required. Your Groq API key from console.groq.com
 *   GROQ_MODEL            Override model (e.g. llama-3.3-70b-versatile)
 *   GROQ_MAX_TOKENS       Override max tokens (default: 8192)
 *   GROQ_TEMPERATURE      Override temperature (default: 0.2)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const readline = require('readline');

const REPO_ROOT = path.resolve(__dirname, '..');
const AGENTS_DIR = path.join(REPO_ROOT, 'agents');
const GROQ_CONFIG_PATH = path.join(REPO_ROOT, '.groq', 'models.json');

// ─── Config ──────────────────────────────────────────────────────────────────

const MODEL_ALIASES = {
  opus: 'llama-3.3-70b-versatile',
  sonnet: 'llama-3.1-70b-versatile',
  haiku: 'llama-3.1-8b-instant',
};

const DEFAULT_CONFIG = {
  maxTokens: 8192,
  temperature: 0.2,
};

function loadGroqConfig() {
  if (fs.existsSync(GROQ_CONFIG_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(GROQ_CONFIG_PATH, 'utf8'));
    } catch {
      return {};
    }
  }
  return {};
}

// ─── Agent parsing ────────────────────────────────────────────────────────────

function parseAgentFile(agentPath) {
  const text = fs.readFileSync(agentPath, 'utf8');
  const match = text.match(/^---\n([\s\S]*?)\n---([\s\S]*)$/);

  if (!match) {
    return { name: path.basename(agentPath, '.md'), model: 'sonnet', systemPrompt: text };
  }

  const frontmatter = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.+)$/);
    if (kv) {
      frontmatter[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '');
    }
  }

  return {
    name: frontmatter.name || path.basename(agentPath, '.md'),
    description: frontmatter.description || '',
    model: frontmatter.model || 'sonnet',
    systemPrompt: match[2].trim(),
  };
}

function resolveModel(agentModel, envOverride, groqConfig) {
  if (envOverride) return envOverride;

  const aliases = {
    ...MODEL_ALIASES,
    ...(groqConfig.modelAliases || {}),
  };

  const lower = (agentModel || 'sonnet').toLowerCase();
  return aliases[lower] || agentModel || aliases.sonnet;
}

function listAgents() {
  if (!fs.existsSync(AGENTS_DIR)) {
    console.error(`Agents directory not found: ${AGENTS_DIR}`);
    process.exit(1);
  }

  const agents = fs.readdirSync(AGENTS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => parseAgentFile(path.join(AGENTS_DIR, f)));

  const groqConfig = loadGroqConfig();
  const maxName = Math.max(...agents.map(a => a.name.length));

  console.log(`\n${'Agent'.padEnd(maxName + 2)} ${'Groq Model'.padEnd(38)} Description`);
  console.log('─'.repeat(120));

  for (const agent of agents.sort((a, b) => a.name.localeCompare(b.name))) {
    const model = resolveModel(agent.model, null, groqConfig);
    const desc = (agent.description || '').slice(0, 60);
    console.log(`${agent.name.padEnd(maxName + 2)} ${model.padEnd(38)} ${desc}`);
  }

  console.log(`\n${agents.length} agents available`);
  console.log('\nUsage:');
  console.log('  GROQ_API_KEY=<key> node scripts/groq-runner.js --agent <name> --prompt "<task>"');
}

// ─── HTTP / Groq API ──────────────────────────────────────────────────────────

function groqRequest(apiKey, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);

    const options = {
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode !== 200) {
            reject(new Error(`Groq API error ${res.statusCode}: ${parsed.error?.message || data}`));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error(`Failed to parse Groq response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function groqStream(apiKey, body, onChunk) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ ...body, stream: true });

    const options = {
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let buffer = '';
      let fullText = '';

      res.on('data', chunk => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const text = parsed.choices?.[0]?.delta?.content || '';
            if (text) {
              onChunk(text);
              fullText += text;
            }
          } catch {
            // skip malformed SSE
          }
        }
      });

      res.on('end', () => resolve(fullText));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ─── Auto Bug-Fix Loop ────────────────────────────────────────────────────────

async function autoBugFix(apiKey, groqConfig, options) {
  console.log('\n🔧 Auto Bug-Fix Mode — running build-error-resolver agent...\n');

  const agentPath = path.join(AGENTS_DIR, 'build-error-resolver.md');
  if (!fs.existsSync(agentPath)) {
    throw new Error('build-error-resolver agent not found');
  }

  const agent = parseAgentFile(agentPath);
  const model = resolveModel(agent.model, process.env.GROQ_MODEL, groqConfig);

  const errorInput = options.prompt || (await readStdin());
  const userPrompt = `Fix the following build/type errors. Provide the minimal code changes needed:\n\n${errorInput}`;

  return runAgentQuery(apiKey, agent, model, userPrompt, groqConfig, options);
}

// ─── Core runner ─────────────────────────────────────────────────────────────

async function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', line => { data += line + '\n'; });
    rl.on('close', () => resolve(data.trim()));
  });
}

async function buildUserPrompt(options) {
  let prompt = options.prompt || '';

  if (options.file) {
    const files = Array.isArray(options.file) ? options.file : [options.file];
    for (const f of files) {
      if (!fs.existsSync(f)) throw new Error(`File not found: ${f}`);
      const content = fs.readFileSync(f, 'utf8');
      const ext = path.extname(f).slice(1) || 'text';
      prompt += `\n\nFile: ${f}\n\`\`\`${ext}\n${content}\n\`\`\``;
    }
  }

  if (options.stdin) {
    const stdinData = await readStdin();
    if (stdinData) prompt += `\n\n${stdinData}`;
  }

  return prompt.trim();
}

async function runAgentQuery(apiKey, agent, model, userPrompt, groqConfig, options) {
  const maxTokens = parseInt(process.env.GROQ_MAX_TOKENS || '') || DEFAULT_CONFIG.maxTokens;
  const temperature = parseFloat(process.env.GROQ_TEMPERATURE || '') || DEFAULT_CONFIG.temperature;

  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: [
      { role: 'system', content: agent.systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };

  const tag = options.noStream ? '' : '';
  process.stderr.write(`\n⚡ Agent: ${agent.name} | Model: ${model} | Tokens: ${maxTokens}\n\n`);

  if (options.noStream) {
    const response = await groqRequest(apiKey, body);
    const text = response.choices?.[0]?.message?.content || '';
    process.stdout.write(text);
    process.stdout.write('\n');

    const usage = response.usage;
    if (usage) {
      process.stderr.write(`\n📊 Tokens: ${usage.prompt_tokens} in / ${usage.completion_tokens} out\n`);
    }
    return text;
  } else {
    const fullText = await groqStream(apiKey, body, chunk => process.stdout.write(chunk));
    process.stdout.write('\n');
    return fullText;
  }
}

async function runAgent(agentName, options) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error('Error: GROQ_API_KEY environment variable is required.');
    console.error('Get your key at: https://console.groq.com/keys');
    process.exit(1);
  }

  const groqConfig = loadGroqConfig();

  // Special modes
  if (options.autoBugFix) {
    return autoBugFix(apiKey, groqConfig, options);
  }

  // Resolve agent file
  const agentPath = path.join(AGENTS_DIR, `${agentName}.md`);
  if (!fs.existsSync(agentPath)) {
    const available = fs.readdirSync(AGENTS_DIR)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''));
    console.error(`Agent not found: ${agentName}`);
    console.error(`Available agents: ${available.join(', ')}`);
    process.exit(1);
  }

  const agent = parseAgentFile(agentPath);
  const model = resolveModel(agent.model, process.env.GROQ_MODEL, groqConfig);
  const userPrompt = await buildUserPrompt(options);

  if (!userPrompt) {
    console.error('Error: No prompt provided. Use --prompt, --file, or --stdin.');
    process.exit(1);
  }

  return runAgentQuery(apiKey, agent, model, userPrompt, groqConfig, options);
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function usage() {
  return [
    '',
    'ECC Groq Runner — Run ECC agents with Groq ultra-fast inference',
    '',
    'Usage:',
    '  GROQ_API_KEY=<key> node scripts/groq-runner.js --agent <name> --prompt "<task>"',
    '  GROQ_API_KEY=<key> node scripts/groq-runner.js --agent code-reviewer --file src/app.ts',
    '  GROQ_API_KEY=<key> node scripts/groq-runner.js --agent build-error-resolver --stdin',
    '  GROQ_API_KEY=<key> node scripts/groq-runner.js --auto-bug-fix --prompt "<error output>"',
    '  GROQ_API_KEY=<key> node scripts/groq-runner.js --list',
    '',
    'Options:',
    '  --agent <name>       Agent to run (see --list for all 47 agents)',
    '  --prompt "<text>"    Task or question for the agent',
    '  --file <path>        Read file content as context (repeatable)',
    '  --stdin              Read additional context from stdin',
    '  --no-stream          Disable streaming (wait for full response)',
    '  --auto-bug-fix       Run build-error-resolver on error input',
    '  --list               List all agents with their Groq models',
    '  -h, --help           Show this help',
    '',
    'Environment:',
    '  GROQ_API_KEY         Your Groq API key (console.groq.com/keys)',
    '  GROQ_MODEL           Override model for this run',
    '  GROQ_MAX_TOKENS      Max output tokens (default: 8192)',
    '  GROQ_TEMPERATURE     Temperature (default: 0.2)',
    '',
    'Examples:',
    '  # Code review a file',
    '  GROQ_API_KEY=gsk_... node scripts/groq-runner.js \\',
    '    --agent code-reviewer --file src/api/handler.ts',
    '',
    '  # Plan a feature with opus-tier model',
    '  GROQ_API_KEY=gsk_... node scripts/groq-runner.js \\',
    '    --agent planner --prompt "Add OAuth2 login with Google"',
    '',
    '  # Auto-fix build errors piped from npm',
    '  npm run build 2>&1 | GROQ_API_KEY=gsk_... node scripts/groq-runner.js \\',
    '    --agent build-error-resolver --stdin',
    '',
    '  # Security review with deepseek reasoning model',
    '  GROQ_MODEL=deepseek-r1-distill-llama-70b GROQ_API_KEY=gsk_... \\',
    '    node scripts/groq-runner.js --agent security-reviewer --file src/auth.ts',
    '',
  ].join('\n');
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { help: true };
  }

  const options = {
    agent: null,
    prompt: '',
    file: [],
    stdin: false,
    noStream: false,
    list: false,
    autoBugFix: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--agent') options.agent = argv[++i];
    else if (arg === '--prompt') options.prompt = argv[++i];
    else if (arg === '--file') options.file.push(argv[++i]);
    else if (arg === '--stdin') options.stdin = true;
    else if (arg === '--no-stream') options.noStream = true;
    else if (arg === '--list') options.list = true;
    else if (arg === '--auto-bug-fix') options.autoBugFix = true;
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(usage());
    return;
  }

  if (options.list) {
    listAgents();
    return;
  }

  if (!options.agent && !options.autoBugFix) {
    console.error('Error: --agent <name> is required (or use --auto-bug-fix)');
    console.error('Use --list to see all available agents, or --help for usage.');
    process.exit(1);
  }

  await runAgent(options.agent, options);
}

main().catch(err => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
