---
name: groq-api
description: Groq API integration patterns for ECC agents. Use when building apps with Groq inference, routing ECC agents through Groq, or optimizing LLM calls for ultra-low latency. Covers model selection, streaming, auto bug-fix loops, and multi-agent orchestration on Groq.
origin: ECC
---

# Groq API Integration

Run all 47 ECC agents with ultra-fast Groq inference — same agents, same skills, Groq speed.

## When to Activate

- Building apps that use Groq for LLM inference
- Running ECC agents without Claude API access
- Need ultra-low latency responses (< 1s for most tasks)
- Cost-optimized pipelines using open-source models
- CI/CD auto bug-fix loops powered by Groq

## Setup

```bash
# 1. Get your Groq API key
# https://console.groq.com/keys

# 2. Set environment variable
export GROQ_API_KEY=gsk_...

# 3. Adapt agents for Groq
node scripts/groq-adapt-agents.js

# 4. Run any agent
node scripts/groq-runner.js --agent code-reviewer --file src/app.ts
```

## Model Selection

| ECC Alias | Groq Model                       | Best For                              |
|-----------|----------------------------------|---------------------------------------|
| `opus`    | `llama-3.3-70b-versatile`        | Planning, architecture, deep analysis |
| `sonnet`  | `llama-3.1-70b-versatile`        | Code review, most dev tasks           |
| `haiku`   | `llama-3.1-8b-instant`           | Fast tasks, doc updates, simple fixes |
| —         | `deepseek-r1-distill-llama-70b`  | Math, logic, reasoning-heavy tasks    |
| —         | `mixtral-8x7b-32768`             | Diverse coding, 32k context           |
| —         | `llama-3.2-90b-vision-preview`   | Vision + code tasks                   |

Override model at runtime:
```bash
GROQ_MODEL=deepseek-r1-distill-llama-70b node scripts/groq-runner.js \
  --agent security-reviewer --file src/auth.ts
```

## Common Agent Patterns

### Code Review
```bash
node scripts/groq-runner.js --agent code-reviewer --file src/api.ts
# Multiple files:
node scripts/groq-runner.js --agent code-reviewer \
  --file src/api.ts --file src/middleware.ts
```

### Auto Bug Fix (pipe errors directly)
```bash
npm run build 2>&1 | node scripts/groq-runner.js \
  --agent build-error-resolver --stdin

# Or pass error text directly:
node scripts/groq-runner.js --auto-bug-fix \
  --prompt "TS2345: Argument of type 'string' is not assignable..."
```

### Feature Planning
```bash
node scripts/groq-runner.js --agent planner \
  --prompt "Add real-time collaboration with WebSockets to the editor"
```

### TDD Workflow
```bash
node scripts/groq-runner.js --agent tdd-guide \
  --prompt "Write tests for the UserService.createUser() method" \
  --file src/services/user.service.ts
```

### Security Scan
```bash
node scripts/groq-runner.js --agent security-reviewer \
  --file src/auth/jwt.ts --file src/middleware/auth.ts
```

### Architecture Review
```bash
node scripts/groq-runner.js --agent architect \
  --prompt "Review this microservices architecture for scalability" \
  --file docs/architecture.md
```

## JavaScript/TypeScript SDK

```typescript
import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Basic completion
const completion = await groq.chat.completions.create({
  model: 'llama-3.1-70b-versatile',
  messages: [{ role: 'user', content: 'Review this code...' }],
  max_tokens: 4096,
  temperature: 0.2,
});

// Streaming
const stream = await groq.chat.completions.create({
  model: 'llama-3.3-70b-versatile',
  messages: [{ role: 'user', content: 'Plan this feature...' }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

## Python SDK

```python
from groq import Groq

client = Groq(api_key=os.environ["GROQ_API_KEY"])

# Basic completion
response = client.chat.completions.create(
    model="llama-3.1-70b-versatile",
    messages=[{"role": "user", "content": "Fix this bug..."}],
    max_tokens=4096,
    temperature=0.2,
)

# Streaming
stream = client.chat.completions.create(
    model="llama-3.3-70b-versatile",
    messages=[{"role": "user", "content": prompt}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")
```

## CI/CD Auto Bug-Fix Pipeline

```yaml
# .github/workflows/auto-fix.yml
- name: Build
  id: build
  run: npm run build
  continue-on-error: true

- name: Auto Fix Build Errors
  if: steps.build.outcome == 'failure'
  env:
    GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
  run: |
    npm run build 2>&1 | node scripts/groq-runner.js \
      --agent build-error-resolver --stdin --no-stream > fix.md
    cat fix.md
```

## Multi-Agent Pipeline (Node.js)

```javascript
const { execSync } = require('child_process');

async function devPipeline(file) {
  const run = (agent, args = '') =>
    execSync(
      `node scripts/groq-runner.js --agent ${agent} --file ${file} ${args} --no-stream`,
      { env: { ...process.env, GROQ_API_KEY: process.env.GROQ_API_KEY }, encoding: 'utf8' }
    );

  // 1. Plan → 2. TDD → 3. Review → 4. Security
  const plan = run('planner', `--prompt "Implement feature in ${file}"`);
  const tests = run('tdd-guide');
  const review = run('code-reviewer');
  const security = run('security-reviewer');

  return { plan, tests, review, security };
}
```

## Environment Variables Reference

| Variable          | Default                    | Description                     |
|-------------------|----------------------------|---------------------------------|
| `GROQ_API_KEY`    | required                   | Groq API key                    |
| `GROQ_MODEL`      | from agent frontmatter     | Override model for this run     |
| `GROQ_MAX_TOKENS` | 8192                       | Max output tokens               |
| `GROQ_TEMPERATURE`| 0.2                        | Sampling temperature (0–1)      |

## Custom Model Mapping

Edit `.groq/models.json` to change default alias mappings:

```json
{
  "modelAliases": {
    "opus": "deepseek-r1-distill-llama-70b",
    "sonnet": "llama-3.3-70b-versatile",
    "haiku": "llama-3.1-8b-instant"
  }
}
```

Then re-run the adapter:
```bash
node scripts/groq-adapt-agents.js
```

## Troubleshooting

**Rate limit errors** — Groq has generous free tier limits; switch to `haiku`-tier model if hitting limits.

**Context too long** — Use `mixtral-8x7b-32768` (32k context) or split large files.

**Slow responses** — Ensure using `llama-3.1-8b-instant` for latency-critical paths.

**Authentication errors** — Verify `GROQ_API_KEY` is set and starts with `gsk_`.
