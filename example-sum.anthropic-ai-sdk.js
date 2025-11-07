/**
 * Example script that calls Claude Code API to calculate 1 + 2
 * Run this script with: node example-sum.js
 */

import { Anthropic } from "@anthropic-ai/sdk";
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Check if API key is available
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('❌ Error: ANTHROPIC_API_KEY not found in environment variables.');
  console.error('Please create a .env file and add: ANTHROPIC_API_KEY=your_api_key_here');
  process.exit(1);
}

// Instantiate the SDK client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function main() {
  console.log("Asking Claude: What is the sum of 1 + 2?");
  console.log("=".repeat(50));

  const response = await anthropic.messages.create({
    "model": "claude-sonnet-4-5-20250929",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: "What is the sum of 1 + 2? Please provide just the numerical answer.",
      },
    ],
  });

  console.log("\nClaude's response:");
  console.log("=".repeat(50));
  
  // Extract and print the text response
  response.content.forEach((block, index) => {
    if (block.type === 'text') {
      console.log(block.text);
    }
  });
  
  console.log("=".repeat(50));
}

main().catch(console.error);
