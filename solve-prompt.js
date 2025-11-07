import { query } from "@anthropic-ai/claude-agent-sdk";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

async function solvePrompt() {
  try {
    console.log("Starting Claude Code agent to read and execute prompt from my-prompt.md\n");
    
    // Let Claude Code agent read the file and act on the prompt itself
    for await (const message of query({
      prompt: "Read the file my-prompt.md and follow the instructions in that file.",
      options: {
        maxTurns: 10,
        allowedTools: ["Read", "Write", "Edit", "Grep", "List"]
      }
    })) {
      if (message.type === "result") {
        console.log("\n---\nFinal Result:", message.result);
      } else if (message.type === "text") {
        // Stream text as it arrives
        process.stdout.write(message.text);
      }
    }
  } catch (error) {
    console.error("Error processing prompt:", error);
    process.exit(1);
  }
}

// Run the function
solvePrompt();
