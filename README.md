# Skills Tool Example

This example demonstrates how to use `createSkillTool` with AI SDK's `ToolLoopAgent` to give an AI agent modular capabilities (skills) that it can discover and use on demand.

## Overview

The example includes three bash-based skills:

- **csv** - Analyze and transform CSV files using awk, cut, sort
- **text** - Analyze and search text files using grep, sed, wc
- **skill-creator** - Create and package new skills

## Key Feature: Local Filesystem Access

This example uses **ReadWriteFs** from `just-bash` to give the AI agent direct access to your local filesystem. All files are read from and written to the `workspace/` directory on your disk, not in a virtual environment.

## How It Works

1. `createSkillTool` discovers skills and returns their files
2. Files are passed to `createBashTool` for sandbox upload
3. The `ToolLoopAgent`:
   - Sees available skills in the `skill` tool description
   - Calls `skill` to get detailed instructions
   - Uses `bash` to run the skill's scripts
   - Loops until the task is complete

## Running the Example

```bash
# From the repository root
npx tsx index.ts
```

## Path Configuration - Critical Understanding

This is the most important part of the configuration. Understanding how paths work is essential for using this tool correctly.

### The Problem

When using `ReadWriteFs` with `bash-tool`, there's a potential path conflict:

- `ReadWriteFs` expects paths relative to its `root` directory
- `bash-tool` uses a `destination` parameter and prepends it to file paths
- If not configured correctly, this can create nested directories like `workspace/workspace/`

### The Solution

The correct configuration is:

```typescript
import { Bash, ReadWriteFs } from "just-bash";

// 1. ReadWriteFs root: "." (current directory)
// This means all paths are relative to the project root
const rwfs = new ReadWriteFs({ root: "." });

// 2. Bash instance: uses virtual path "/workspace"
const bash = new Bash({
  fs: rwfs,
  cwd: "/workspace",
});

// 3. Custom sandbox interface
const sandbox = {
  async executeCommand(command: string) {
    const result = await bash.exec(command);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  },
  async readFile(filePath: string) {
    return bash.fs.readFile(filePath);
  },
  async writeFiles(files: Array<{ path: string; content: string }>) {
    for (const file of files) {
      await bash.fs.writeFile(file.path, file.content);
    }
  },
};

// 4. bash-tool destination: "/workspace" (virtual path)
const { tools } = await createBashTool({
  sandbox: sandbox as any,
  destination: "/workspace",
  files,
  extraInstructions: instructions,
});
```

### How Paths Are Resolved

Here's what happens step by step:

1. **bash-tool receives files** with paths like `"skills/csv/SKILL.md"`
2. **bash-tool prepends destination**: `"/workspace" + "skills/csv/SKILL.md"` → `"/workspace/skills/csv/SKILL.md"`
3. **bash-tool calls sandbox.writeFiles()** with the full path
4. **ReadWriteFs receives the path**: `"/workspace/skills/csv/SKILL.md"`
5. **ReadWriteFs resolves it**: Since `root` is `"."`, the absolute path `"/workspace/skills/csv/SKILL.md"` is treated as a relative path from the project root
6. **Final file location**: `./workspace/skills/csv/SKILL.md` ✅

### Why This Works

- `ReadWriteFs` with `root: "."` treats all paths as relative to the project root
- Absolute paths like `/workspace/file.txt` are resolved to `./workspace/file.txt`
- This creates a clean mapping between virtual paths (`/workspace/...`) and real paths (`./workspace/...`)

### Common Mistakes

❌ **Wrong**: `ReadWriteFs({ root: "workspace" })` + `destination: "/workspace"`
- Result: Files go to `./workspace/workspace/...` (nested)

❌ **Wrong**: `ReadWriteFs({ root: "." })` + `destination: "./workspace"`
- Result: `cd "./workspace"` fails in the sandbox

✅ **Correct**: `ReadWriteFs({ root: "." })` + `destination: "/workspace"`
- Result: Files go to `./workspace/...` (correct!)

## Code Overview

```typescript
import { ToolLoopAgent } from "ai";
import {
  experimental_createSkillTool as createSkillTool,
  createBashTool,
} from "bash-tool";
import { Bash, ReadWriteFs } from "just-bash";

// Create ReadWriteFs for local filesystem access
const rwfs = new ReadWriteFs({ root: "." });
const bash = new Bash({ fs: rwfs, cwd: "/workspace" });

// Create custom sandbox
const sandbox = {
  async executeCommand(command: string) {
    const result = await bash.exec(command);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  },
  async readFile(filePath: string) {
    return bash.fs.readFile(filePath);
  },
  async writeFiles(files: Array<{ path: string; content: string }>) {
    for (const file of files) {
      await bash.fs.writeFile(file.path, file.content);
    }
  },
};

// Discover skills and get files
const { skill, skills, files, instructions } = await createSkillTool({
  skillsDirectory: "./skills",
});

// Create bash tool with skill files
const { tools } = await createBashTool({
  sandbox: sandbox as any,
  destination: "/workspace",
  files,
  extraInstructions: instructions,
});

// Create agent with both tools
const agent = new ToolLoopAgent({
  model: "anthropic/claude-haiku-4.5",
  tools: {
    skill,
    bash: tools.bash,
  },
});

// Run the agent
const result = await agent.generate({
  prompt: "Analyze this CSV data...",
});
```

## Skill Structure

Each skill is a directory containing:

```
skills/
├── csv/
│   ├── SKILL.md      # Instructions (YAML frontmatter + markdown)
│   ├── analyze.sh    # Bash scripts
│   ├── filter.sh
│   ├── select.sh
│   └── sort.sh
├── text/
│   ├── SKILL.md
│   ├── stats.sh
│   ├── search.sh
│   ├── extract.sh
│   └── wordfreq.sh
└── skill-creator/
    ├── SKILL.md
    ├── license.txt
    └── scripts/
        ├── init_skill.py
        ├── package_skill.py
        └── quick_validate.py
```

## Creating Your Own Skills

1. Create a directory under `skills/`
2. Add a `SKILL.md` with frontmatter:
   ```yaml
   ---
   name: my-skill
   description: What this skill does
   ---

   # Instructions for the AI

   Explain how to use the scripts...
   ```
3. Add bash scripts that the AI can execute

## Instruction-Only Skills (No Bash Required)

Skills don't need scripts - they can be pure instructions. For skills that only contain a `SKILL.md` with no executable scripts, you can use `createSkillTool` standalone without `createBashTool`:

```typescript
import { experimental_createSkillTool as createSkillTool } from "bash-tool";

// Discover instruction-only skills
const { skill, skills } = await createSkillTool({
  skillsDirectory: "./knowledge",
});

// Use just the skill tool - no bash needed
const agent = new ToolLoopAgent({
  model: "anthropic/claude-haiku-4.5",
  tools: { skill },
});
```

Example instruction-only skill (`knowledge/json-guidelines/SKILL.md`):

```yaml
---
name: json-format
description: Guidelines for formatting JSON responses
---

# JSON Formatting Guidelines

When outputting JSON:
1. Use 2-space indentation
2. Use camelCase for property names
3. Wrap arrays in descriptive objects
```

This is useful for:
- Style guides and formatting rules
- Domain knowledge and terminology
- Process documentation
- Best practices the AI should follow

## Key Concepts

- **Composable**: `createSkillTool` returns files, you control the sandbox via `createBashTool`
- **Standalone mode**: Skills with only instructions work without `createBashTool`
- **ToolLoopAgent**: AI SDK's agent that automatically loops through tool calls until done
- **Progressive disclosure**: The AI only sees skill names initially, loading full instructions on demand
- **Bash-only**: Scripts use standard Unix tools (awk, sed, grep, sort, etc.)
- **Local filesystem**: ReadWriteFs provides direct access to your local disk, not a virtual environment

## Filesystem Access

All file operations happen in the `workspace/` directory:

- **Input files**: Read from `workspace/`
- **Output files**: Written to `workspace/`
- **Skill scripts**: Available at `/workspace/skills/<skill-name>/scripts/`

This means:
- You can inspect files created by the AI in `workspace/`
- Files persist between runs
- You can manually edit files in `workspace/` and the AI will see them
- No virtual machine overhead - everything runs on your local machine
