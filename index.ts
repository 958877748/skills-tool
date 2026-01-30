/**
 * 示例：使用 createSkillTool 配合 AI SDK ToolLoopAgent
 *
 * 本示例演示如何创建一个具有技能的 AI 代理，
 * 可以使用 bash 工具处理 CSV 和文本文件。
 * 所有文件和操作都在 workspace 目录中进行。
 *
 * 运行命令：npx tsx index.ts
 */

import path from "node:path";
import { createBashTool } from "bash-tool";
import { experimental_createSkillTool as createSkillTool } from "bash-tool";
import { createDeepSeek } from '@ai-sdk/deepseek';
import { ToolLoopAgent } from "ai";
import { Bash, ReadWriteFs } from "just-bash";
import { mkdirSync, existsSync } from "node:fs";

const deepseek = createDeepSeek({
  apiKey: 'sk-ce8bdf1fd8ad49439efb3fbbcd76cb7c',
});

async function main() {
  // 确保 workspace 目录存在
  const workspaceDir = path.join(process.cwd(), "workspace");
  if (!existsSync(workspaceDir)) {
    mkdirSync(workspaceDir, { recursive: true });
  }
  console.log(`📁 工作目录: ${workspaceDir}\n`);

  // 发现技能并获取需要上传的文件
  const { skill, skills, files, instructions } = await createSkillTool({
    skillsDirectory: path.join("skills"),
  });

  console.log("可用技能：");
  for (const skill of skills) {
    console.log(`  - ${skill.name}: ${skill.description}`);
  }
  console.log("");

  // 创建 ReadWriteFs - 直接访问本地文件系统
  // root 设置为 "./workspace"，让 AI 只能看到 workspace 里面的内容
  const rwfs = new ReadWriteFs({ root: "./workspace" });

  // 创建 Bash 实例
  // cwd 设置为 "/"，因为 AI 的根目录就是 workspace
  const bash = new Bash({
    fs: rwfs,
    cwd: "/",
  });

  // 创建自定义沙盒接口
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

  // 创建带有技能文件的 bash 工具
  // 关键：使用自定义 sandbox，destination 设置为 "/"
  // 因为 AI 的根目录就是 workspace，所以 destination 是 "/"
  const { tools } = await createBashTool({
    sandbox: sandbox as any,
    destination: "/",
    files,
    extraInstructions: instructions,
  });

  // 使用技能创建代理
  const agent = new ToolLoopAgent({
    model: deepseek('deepseek-chat'),
    tools: {
      skill,
      bash: tools.bash,
      readFile: tools.readFile,
      writeFile: tools.writeFile,
    },
    instructions: `你是一个具有技能访问权限的助手。
使用 skill 工具发现如何使用技能，然后使用 bash 运行其脚本。
技能位于 /skills/<skill-name>/。
所有文件操作都在根目录 / 中进行。`,
    onStepFinish: ({ toolCalls, toolResults }) => {
      if (toolCalls && toolCalls.length > 0) {
        for (const call of toolCalls) {
          console.log(`工具: ${call.toolName}`);
          if (call.toolName === "skill" && "input" in call) {
            const input = call.input as { skillName: string };
            console.log(`  加载技能: ${input.skillName}`);
          } else if (call.toolName === "bash" && "input" in call) {
            const input = call.input as { command: string };
            console.log(`  命令: ${input.command}`);
          }
        }
      }
      if (toolResults && toolResults.length > 0) {
        for (const result of toolResults) {
          if (result.toolName === "bash" && "output" in result) {
            const output = result.output as {
              stdout: string;
              exitCode: number;
            };
            if (output.stdout) {
              console.log(`  输出:\n${output.stdout.slice(0, 500)}`);
            }
          }
        }
        console.log("");
      }
    },
  });

  // 示例提示词 - AI 会根据需要发现和使用技能
  let prompt = `
    我有一个包含销售数据的 CSV 文件。内容如下：

    date,product,quantity,price,region
    2024-01-15,Widget A,100,29.99,North
    2024-01-15,Widget B,50,49.99,South
    2024-01-16,Widget A,75,29.99,East
    2024-01-16,Widget C,200,19.99,North
    2024-01-17,Widget B,30,49.99,West
    2024-01-17,Widget A,150,29.99,North

    请：
    1. 首先，将数据写入 /sales.csv 文件
    2. 使用 csv 技能分析文件
    3. 筛选出仅包含北部地区的数据
    4. 按数量排序（从高到低）
  `;

  // prompt = `使用duckduckgo_seach py库  创建一个搜索技能`;

  console.log("正在向代理发送提示词...\n");

  const result = await agent.generate({ prompt });

  console.log("\n=== 最终响应 ===\n");
  console.log(result.text);

  console.log("\n=== 代理统计 ===");
  console.log(`步骤数: ${result.steps.length}`);
  console.log(`总令牌数: ${result.usage.totalTokens}`);
}

main().catch(console.error);
