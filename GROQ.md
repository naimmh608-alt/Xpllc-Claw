# Groq Integration for ECC

Run all **47 ECC agents** — code reviewer, auto bug fixer, planner, TDD guide, security scanner, and more — powered by **Groq's ultra-fast inference** instead of the Claude API.

> ⚡ Groq delivers tokens at **800+ tokens/second** on Llama 3 models — near-instant responses for your development workflows.

---

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/affaan-m/everything-claude-code.git
cd everything-claude-code

# 2. Get your free Groq API key
# → https://console.groq.com/keys

# 3. Set your key
export GROQ_API_KEY=gsk_your_key_here

# 4. Adapt agents for Groq (maps Claude aliases → Groq models)
node scripts/groq-adapt-agents.js

# 5. Run any agent!
node scripts/groq-runner.js --agent code-reviewer --file src/app.ts
```

---

## What's Included

| File | Purpose |
|------|---------|
| `scripts/groq-runner.js` | CLI: run any ECC agent via Groq API |
| `scripts/groq-adapt-agents.js` | Adapts agent frontmatter (maps model aliases) |
| `.groq/models.json` | Model config & alias mappings |
| `skills/groq-api/SKILL.md` | Skill docs for building Groq-powered apps |

---

## Model Mapping

The ECC agents use Claude aliases (`opus`, `sonnet`, `haiku`). The Groq integration maps these automatically:

| Claude Alias | Groq Model | Speed | Best For |
|---|---|---|---|
| `opus` | `llama-3.3-70b-versatile` | Fast | Planning, architecture, deep analysis |
| `sonnet` | `llama-3.1-70b-versatile` | Fast | Code review, most dev tasks |
| `haiku` | `llama-3.1-8b-instant` | Ultra-fast | Docs, simple fixes, high-volume |

**Additional Groq models available:**

| Model | Context | Notes |
|---|---|---|
| `deepseek-r1-distill-llama-70b` | 131k | Best for reasoning/math tasks |
| `mixtral-8x7b-32768` | 32k | Mixture-of-experts coding |
| `gemma2-9b-it` | 8k | Lightweight instruction following |
| `llama-3.2-90b-vision-preview` | 131k | Vision + code |

Customize mappings in `.groq/models.json`.

---

## Usage Examples

### List all 47 agents with their Groq models
```bash
node scripts/groq-runner.js --list
```

### Code Review
```bash
node scripts/groq-runner.js --agent code-reviewer --file src/api/handler.ts
```

### Auto Bug Fix (pipe build errors directly)
```bash
npm run build 2>&1 | node scripts/groq-runner.js \
  --agent build-error-resolver --stdin
```

### Feature Planning (uses opus-tier = llama-3.3-70b)
```bash
node scripts/groq-runner.js --agent planner \
  --prompt "Add WebSocket real-time sync to the dashboard"
```

### TDD Workflow
```bash
node scripts/groq-runner.js --agent tdd-guide \
  --prompt "Write tests for UserService" \
  --file src/services/user.service.ts
```

### Security Audit
```bash
node scripts/groq-runner.js --agent security-reviewer \
  --file src/auth/jwt.ts
```

### Use a specific Groq model (override)
```bash
GROQ_MODEL=deepseek-r1-distill-llama-70b \
  node scripts/groq-runner.js --agent architect \
  --prompt "Design a distributed job queue system"
```

### Dry-run agent adaptation (preview changes)
```bash
node scripts/groq-adapt-agents.js --dry-run
```

### List available models
```bash
node scripts/groq-adapt-agents.js --list-models
```

---

## Environment Variables

```bash
GROQ_API_KEY=gsk_...           # Required
GROQ_MODEL=llama-3.3-70b-versatile  # Override model
GROQ_MAX_TOKENS=8192           # Max output tokens (default: 8192)
GROQ_TEMPERATURE=0.2           # Temperature (default: 0.2)
```

---

## All 47 Agents Available on Groq

| Agent | Groq Tier | Purpose |
|---|---|---|
| `planner` | opus | Implementation planning |
| `architect` | opus | System design |
| `chief-of-staff` | opus | High-level orchestration |
| `code-reviewer` | sonnet | Code quality review |
| `security-reviewer` | sonnet | Vulnerability detection |
| `build-error-resolver` | sonnet | Fix build/type errors |
| `tdd-guide` | sonnet | Test-driven development |
| `e2e-runner` | sonnet | End-to-end test generation |
| `doc-updater` | haiku | Documentation updates |
| `refactor-cleaner` | sonnet | Dead code cleanup |
| `typescript-reviewer` | sonnet | TS/JS code review |
| `python-reviewer` | sonnet | Python code review |
| `go-reviewer` | sonnet | Go code review |
| `rust-reviewer` | sonnet | Rust code review |
| `java-reviewer` | sonnet | Java/Spring Boot review |
| `cpp-reviewer` | sonnet | C/C++ code review |
| `database-reviewer` | sonnet | PostgreSQL/SQL review |
| `loop-operator` | sonnet | Autonomous loop execution |
| `harness-optimizer` | opus | Agent harness tuning |
| ... and 28 more | | |

---

## CI/CD Integration

```yaml
# .github/workflows/groq-review.yml
name: Groq Code Review

on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }

      - name: Run Groq Code Review
        env:
          GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
        run: |
          git diff origin/main...HEAD --name-only | \
          grep -E '\.(ts|js|py|go|rs)$' | \
          xargs -I{} node scripts/groq-runner.js \
            --agent code-reviewer --file {} --no-stream

      - name: Auto Fix Build Errors
        if: failure()
        env:
          GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
        run: |
          npm run build 2>&1 | node scripts/groq-runner.js \
            --agent build-error-resolver --stdin --no-stream
```

---

## Customizing Model Mappings

Edit `.groq/models.json`:

```json
{
  "modelAliases": {
    "opus":   "deepseek-r1-distill-llama-70b",
    "sonnet": "llama-3.3-70b-versatile",
    "haiku":  "llama-3.1-8b-instant"
  }
}
```

Then re-run:
```bash
node scripts/groq-adapt-agents.js
```

---

## How It Works

1. **`groq-adapt-agents.js`** reads each agent's YAML frontmatter (`model: opus`) and maps it to the corresponding Groq model ID, writing adapted copies to `.groq/agents/`.

2. **`groq-runner.js`** loads the original agent from `agents/`, resolves the model alias via `.groq/models.json`, constructs a chat completion request to `api.groq.com/openai/v1/chat/completions` (OpenAI-compatible), and streams the response to stdout.

3. All existing **agent skills, system prompts, and workflows** are preserved exactly — only the model backend changes from Claude to Groq.

---

## Links

- 🔑 Get Groq API key: https://console.groq.com/keys
- 📖 Groq docs: https://console.groq.com/docs
- 🤖 ECC repo: https://github.com/affaan-m/everything-claude-code
