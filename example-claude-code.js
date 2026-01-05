/**
 * Claude Agent SDK Integration - Reading and Executing Prompts
 * 
 * This example demonstrates how to use Claude Agent SDK to read a file and execute
 * the instructions contained within it.
 * 
 * Prerequisites:
 * 1. Your .env file should contain ANTHROPIC_API_KEY
 * 2. Run with: node example-claude-code.js
 * 
 * See: https://docs.claude.com/en/api/agent-sdk/typescript
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Check if API key is available
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('❌ Error: ANTHROPIC_API_KEY not found in environment variables.');
  console.error('Please check your .env file and ensure ANTHROPIC_API_KEY is set.');
  process.exit(1);
}

async function main() {
  try {
    console.log("Starting Claude Agent...");
    console.log("=".repeat(50));
    
    // Use the query function from the SDK
    const q = query({
      prompt: "Please read the file 'my-prompt.md' in the current directory and follow the instructions in it. Provide the answer to what it asks.",
      options: {
        systemPrompt: "You are a helpful assistant that can read files and perform calculations. When asked to perform a calculation, provide the numerical answer.",
        maxTurns: 50,
      }
    });

    // Collect results from the async iterator
    let finalResult = null;
    for await (const message of q) {
      console.log("Message:", JSON.stringify(message, null, 2));
      finalResult = message;
    }

    console.log("\n" + "=".repeat(50));
    console.log("Final Result:");
    console.log("=".repeat(50));
    console.log(finalResult);
    console.log("=".repeat(50));
    
  } catch (error) {
    console.error("❌ Error occurred during agent execution:");
    console.error(error);
    
    // Log more details if available
    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response data:", error.response.data);
    }
  }
}

main().catch(console.error);
