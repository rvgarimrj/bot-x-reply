# Auto-Parallel Execution Skill

> *"Simplicidade é a sofisticação máxima."* — Steve Jobs

This skill ensures that Claude Code automatically maximizes parallelism in every task execution.

## Activation

This skill activates **AUTOMATICALLY** when:
- User mentions "parallel", "paralelo", "simultaneous", "concurrent", "em paralelo"
- Task involves 3+ file modifications
- Task crosses multiple domains (frontend + backend + tests)
- User explicitly requests `/parallel` or optimization
- Research phase requires multiple searches
- i18n updates are needed (always 5 locales in parallel)

## Behavior

When active, this skill ensures:

1. **All independent tool calls are batched** into single messages
2. **Specialist agents are spawned in parallel** when beneficial
3. **i18n updates always include all 5 locales** simultaneously
4. **Validation runs all checks together** (type-check + lint + tests)

## Quick Commands

| Command | Effect |
|---------|--------|
| `/parallel [task]` | Force parallel execution mode for this task |
| `/parallel --analyze` | Show parallelization opportunities without executing |
| `/batch` | Show current batching opportunities |
| `/optimize` | Analyze and suggest parallelization improvements |

## Metrics Tracked

- **Parallel tool calls per message**: Should be 2+ when possible
- **Agent spawn efficiency**: Multiple agents in single message when applicable
- **i18n update batching**: Always 5 locales together
- **Validation batching**: type-check + lint + tests in one message

## Parallelization Patterns

### Pattern 1: Research Phase

**❌ Sequential (FORBIDDEN):**
```
Grep pattern1 → wait → Grep pattern2 → wait → Read file1
```

**✅ Parallel (MANDATORY):**
```
ONE message with:
- Grep(pattern1)
- Grep(pattern2)
- Grep(pattern3)
- Read(file1)
- Read(file2)
```

### Pattern 2: Multi-Agent Tasks

**❌ Sequential (FORBIDDEN):**
```
Task(backend-architect) → wait for result → Task(frontend-developer)
```

**✅ Parallel (MANDATORY):**
```
ONE message with:
- Task(backend-architect, "Design API for X")
- Task(frontend-developer, "Design UI for X")
- Task(test-writer-fixer, "Design tests for X")
```

### Pattern 3: i18n Updates

**❌ Sequential (FORBIDDEN):**
```
Edit pt-BR.json → Edit en-US.json → Edit es.json → Edit fr.json → Edit zh-CN.json
```

**✅ Parallel (MANDATORY):**
```
ONE message with:
- Edit(pt-BR.json)
- Edit(en-US.json)
- Edit(es.json)
- Edit(fr.json)
- Edit(zh-CN.json)
```

### Pattern 4: Validation

**❌ Sequential (FORBIDDEN):**
```
npm run type-check → npm run lint → npm test
```

**✅ Parallel (MANDATORY):**
```
ONE message with:
- Bash(npm run type-check)
- Bash(npm run lint)
- Bash(npm test)
```

## Integration with Other Skills

This skill enhances:

| Skill | Enhancement |
|-------|-------------|
| **i18n-first** | Ensures all 5 locales updated in parallel |
| **design-review** | Multiple viewport tests in parallel |
| **test-writer** | Multiple test files in parallel |
| **production-readiness** | Multiple audits in parallel |

## Decision Tree

```
Task received
    │
    ▼
┌─────────────────────────────┐
│ Count independent operations │
└─────────────────────────────┘
    │
    ├── 1 operation → Execute normally
    │
    ├── 2+ operations → BATCH in single message
    │
    └── Complex (3+ domains) → Spawn specialist agents in parallel
```

## Anti-Patterns Detected

This skill will flag and prevent:

1. **Sequential i18n** — Updating locales one by one
2. **Unbatched reads** — Reading files one at a time
3. **Serial validation** — Running checks one after another
4. **Single-agent complex tasks** — Not leveraging specialists
5. **Research fragmentation** — Multiple messages for related searches

## Enforcement

The skill enforces parallelization through:

1. **CLAUDE.md rules** — Mandatory parallel execution protocol
2. **TodoWrite structure** — Todos organized for parallel execution
3. **Auto-detection** — Identifies parallelization opportunities automatically
4. **Metrics tracking** — Reports parallelization efficiency

## Performance Impact

| Scenario | Without Parallel | With Parallel | Savings |
|----------|------------------|---------------|---------|
| 5-file search | 5 round trips | 1 round trip | 80% |
| 3-agent task | 3 sequential | 1 parallel | 66% |
| i18n (5 locales) | 5 edits | 1 batch | 80% |
| Validation | 3 commands | 1 batch | 66% |

## Configuration

This skill respects these settings:

```yaml
auto_parallel:
  enabled: true
  min_batch_size: 2
  max_concurrent_agents: 5
  force_i18n_parallel: true
  force_validation_parallel: true
```

## Limitations (Honest Assessment)

| Limitation | Reality | Mitigation |
|------------|---------|------------|
| Claude Code single-threaded | Agents don't literally run in parallel | Maximize parallelism within constraints |
| Task tool sequential | Sub-agents run one at a time | Group by stage to minimize latency |
| Token overhead | Planning adds tokens | Benefit exceeds cost for complex tasks |
| File conflicts | Agents may want same file | Ownership protocol prevents conflicts |

## See Also

- `/CLAUDE.md` — MANDATORY PARALLEL EXECUTION PROTOCOL section
- `/.claude/agents/orchestrator/auto-parallel.md` — Orchestrator agent details
- `/.claude/agents/bonus/studio-coach.md` — Team coordination patterns
- `/.claude/commands/coordenador-geral.md` — 4-agent delegation pattern


<claude-mem-context>
# Recent Activity

<!-- This section is auto-generated by claude-mem. Edit content outside the tags. -->

### Jan 19, 2026

| ID | Time | T | Title | Read |
|----|------|---|-------|------|
| #811 | 9:57 AM | 🔵 | Auto-Parallel Skill File Confirmed in Directory | ~211 |
| #807 | 9:56 AM | 🟣 | Auto-Parallel Skill Definition Created | ~682 |
</claude-mem-context>