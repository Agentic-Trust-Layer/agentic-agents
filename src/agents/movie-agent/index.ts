// Conditionally load dotenv (only in Node.js, not Cloudflare Workers)
try {
  if (typeof process !== 'undefined' && process.versions?.node) {
    await import("dotenv/config");
  }
} catch (e) {
  // dotenv not available (Cloudflare Workers)
}

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from "openai";
import { ethers } from 'ethers';

// Use Web Crypto API in Workers, Node.js crypto in Node.js
let randomUUID: () => string;
type HashResult = { digest: (encoding: 'hex') => string | Promise<string> };
type HashBuilder = { update: (data: string) => HashResult };
let createHash: (algorithm: string) => HashBuilder;

if (typeof crypto !== 'undefined' && crypto.randomUUID) {
  // Web Crypto API (Cloudflare Workers)
  randomUUID = () => crypto.randomUUID();
  createHash = (algorithm: string) => {
    const encoder = new TextEncoder();
    let dataBuffer = new Uint8Array(0);
    return {
      update: (data: string) => {
        const newData = encoder.encode(data);
        const combined = new Uint8Array(dataBuffer.length + newData.length);
        combined.set(dataBuffer);
        combined.set(newData, dataBuffer.length);
        dataBuffer = combined;
        return {
          digest: async (encoding: 'hex') => {
            const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
          }
        };
      }
    };
  };
} else if (typeof process !== 'undefined' && process.versions?.node) {
  // Node.js crypto
  const cryptoModule = await import('crypto');
  randomUUID = cryptoModule.randomUUID;
  createHash = cryptoModule.createHash;
} else {
  // Fallback
  randomUUID = () => uuidv4();
  createHash = () => {
    throw new Error('Hash not available in this environment');
  };
}
import type { PaymentQuote, PaymentIntent, AgentCallEnvelope, PaymentReceipt } from '../../shared/ap2.js';

import {
  AgentCard,
  Task,
  TaskState,
  TaskStatusUpdateEvent,
  TextPart,
  Message
} from "@a2a-js/sdk";
import {
  InMemoryTaskStore,
  TaskStore,
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
  DefaultRequestHandler,
} from "@a2a-js/sdk/server";
import { A2AHonoApp } from "./hono-adapter.js";
import { openAiToolDefinitions, openAiToolHandlers } from "./tools.js";
import { giveFeedbackWithDelegation, getFeedbackAuthId as serverGetFeedbackAuthId, requestFeedbackAuth } from './agentAdapter.js';
//import { buildDelegationSetup } from './session.js';

type MovieAgentRuntimeEnv = Record<string, string | undefined>;

// Runtime environment bindings (Cloudflare Workers secrets/vars are provided via `env`)
// Populated by setupMovieAgentApp().
let RUNTIME_ENV: MovieAgentRuntimeEnv = {};

// Simple store for contexts
const contexts: Map<string, Message[]> = new Map();

// Default prompt template (used in all environments)
// In Cloudflare Workers, we can't read files, so we embed the prompt here
const DEFAULT_PROMPT = `You are a movie expert. Answer the user's question about movies and film industry personalities, using the searchMovies and searchPeople tools to find out more information as needed. Feel free to call them multiple times in parallel if necessary.{{#if goal}}

Your goal in this task is: {{goal}}{{/if}}

The current date and time is: {{now}}

If the user asks you for specific information about a movie or person (such as the plot or a specific role an actor played), do a search for that movie/actor using the available functions before responding.

## Output Instructions

ALWAYS end your response with either "COMPLETED" or "AWAITING_USER_INPUT" on its own line. If you have answered the user's question, use COMPLETED. If you need more information to answer the question, use AWAITING_USER_INPUT.

<example>
<question>
when was [some_movie] released?
</question>
<output>
[some_movie] was released on October 3, 1992.
COMPLETED
</output>
</example>`;

// Load and render system prompt from file (local dev only) or use default
// In Cloudflare Workers, file system is not available, so we always use the embedded prompt
let filePrompt: string | undefined = undefined;

// Try to read prompt file only in Node.js environment (lazy load to avoid issues in Workers)
async function tryLoadPromptFile(): Promise<string | undefined> {
  // Check if we're in Node.js environment
  if (typeof process === 'undefined' || !process.versions?.node || typeof import.meta === 'undefined' || !import.meta.url) {
    return undefined; // Cloudflare Workers - skip file reading
  }
  
  try {
    // Dynamic import to avoid bundling issues in Workers
    const fs = await import("fs");
    const path = await import("path");
    const { fileURLToPath } = await import("url");
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const promptPath = path.join(__dirname, "movie_agent.prompt");
    
    return fs.readFileSync(promptPath, "utf-8");
  } catch (e) {
    // File read failed, will use default
    console.warn('[MovieAgent] Could not read prompt file, using default:', e);
    return undefined;
  }
}

// Initialize prompt file (only in Node.js, skip in Workers)
if (typeof process !== 'undefined' && process.versions?.node) {
  tryLoadPromptFile().then(prompt => {
    if (prompt) filePrompt = prompt;
  }).catch(() => {
    // Ignore errors, will use default
  });
}

function renderSystemPrompt(goal?: string): string {
  // Use file prompt if available (local dev), otherwise use default (Cloudflare Workers)
  const raw = filePrompt || DEFAULT_PROMPT;
  
  // Remove explicit role line from template
  let content = raw.replace(/^\s*{{role\s+"system"}}\s*\n?/, "");
  const nowStr = new Date().toISOString();
  content = content.replaceAll("{{now}}", nowStr);

  if (goal && goal.length > 0) {
    content = content
      .replaceAll("{{#if goal}}", "")
      .replaceAll("{{/if}}", "")
      .replaceAll("{{goal}}", goal);
  } else {
    // Remove the entire conditional block if no goal is provided
    content = content.replace(/{{#if goal}}[\s\S]*?{{\/if}}/g, "");
  }
  return content;
}

/**
 * MovieAgentExecutor implements the agent's core logic.
 */
class MovieAgentExecutor implements AgentExecutor {
  private cancelledTasks = new Set<string>();

  public cancelTask = async (
        taskId: string,
        eventBus: ExecutionEventBus,
    ): Promise<void> => {
        this.cancelledTasks.add(taskId);
        // The execute loop is responsible for publishing the final state
    };

  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus
  ): Promise<void> {
    const userMessage = requestContext.userMessage;
    const existingTask = requestContext.task;

    // Determine IDs for the task and context
    const taskId = existingTask?.id || uuidv4();
    const contextId = userMessage.contextId || existingTask?.contextId || uuidv4(); // DefaultRequestHandler should ensure userMessage.contextId

    console.log(
      `[MovieAgentExecutor] Processing message ${userMessage.messageId} for task ${taskId} (context: ${contextId})`
    );

    // 1. Publish initial Task event if it's a new task
    if (!existingTask) {
      const initialTask: Task = {
        kind: 'task',
        id: taskId,
        contextId: contextId,
        status: {
          state: "submitted",
          timestamp: new Date().toISOString(),
        },
        history: [userMessage], // Start history with the current user message
        metadata: userMessage.metadata, // Carry over metadata from message if any
      };
      eventBus.publish(initialTask);
    }

    // 2. Publish "working" status update
    const workingStatusUpdate: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId: taskId,
      contextId: contextId,
      status: {
        state: "working",
        message: {
          kind: 'message',
          role: 'agent',
          messageId: uuidv4(),
          parts: [{ kind: 'text', text: 'Processing your question, hang tight!' }],
          taskId: taskId,
          contextId: contextId,
        },
        timestamp: new Date().toISOString(),
      },
      final: false,
    };
    eventBus.publish(workingStatusUpdate);

    // 3. Prepare messages for OpenAI
    const historyForGenkit = contexts.get(contextId) || [];
    if (!historyForGenkit.find(m => m.messageId === userMessage.messageId)) {
      historyForGenkit.push(userMessage);
    }
    contexts.set(contextId, historyForGenkit)

    type ChatMessage = {
      role: 'system' | 'user' | 'assistant' | 'tool';
      content?: string | null;
      tool_call_id?: string;
      // @ts-ignore: allow tool_calls when role is assistant
      tool_calls?: any;
    };

    const systemPrompt = renderSystemPrompt(
      (existingTask?.metadata?.goal as string | undefined) ||
        (userMessage.metadata?.goal as string | undefined)
    );

    const oaiMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...historyForGenkit
        .map((m) => ({
          role: (m.role === 'agent' ? 'assistant' : 'user') as 'user' | 'assistant',
          content: m.parts
            .filter((p): p is TextPart => p.kind === 'text' && !!(p as TextPart).text)
            .map((p) => (p as TextPart).text)
            .join('\n') || null,
        }))
        .filter((m) => !!m.content),
    ];

    const hasUserText = oaiMessages.some((m) => m.role === 'user' && !!m.content && m.content.trim().length > 0);
    if (!hasUserText) {
      console.warn(
        `[MovieAgentExecutor] No valid text messages found in history for task ${taskId}.`
      );
      const failureUpdate: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId: taskId,
        contextId: contextId,
        status: {
          state: "failed",
          message: {
            kind: 'message',
            role: 'agent',
            messageId: uuidv4(),
            parts: [{ kind: 'text', text: 'No message found to process.' }],
            taskId: taskId,
            contextId: contextId,
          },
          timestamp: new Date().toISOString(),
        },
        final: true,
      };
      eventBus.publish(failureUpdate);
      return;
    }

    try {
      // 4. Call OpenAI with function tools, handle tool calls loop
      const client = new OpenAI({ apiKey: RUNTIME_ENV.OPENAI_API_KEY });
      const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

      let assistantText: string | null = null;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const completion = await client.chat.completions.create({
          model,
          messages: oaiMessages as any,
          tools: openAiToolDefinitions as any,
        });

        const msg = completion.choices?.[0]?.message;
        if (!msg) {
          throw new Error('OpenAI returned no message');
        }

        const toolCalls = msg.tool_calls || [];
        if (toolCalls.length > 0) {
          // Add the assistant message that requested tool calls
          oaiMessages.push({
            role: 'assistant',
            content: msg.content ?? null,
            // @ts-ignore
            tool_calls: toolCalls,
          });

          for (const call of toolCalls) {
            const name = call.function?.name as string;
            const id = call.id as string;
            const argsJson = call.function?.arguments || '{}';
            let args: any = {};
            try { args = JSON.parse(argsJson); } catch {}
            const handler = openAiToolHandlers[name];
            if (!handler) {
              oaiMessages.push({ role: 'tool', tool_call_id: id, content: `Unknown tool: ${name}` });
              continue;
            }
            const result = await handler(args);
            oaiMessages.push({ role: 'tool', tool_call_id: id, content: JSON.stringify(result) });
          }
          // Continue loop for another model turn
          continue;
        }

        assistantText = msg.content ?? '';
        break;
      }

      // Check if the request has been cancelled
      if (this.cancelledTasks.has(taskId)) {
        console.log(`[MovieAgentExecutor] Request cancelled for task: ${taskId}`);

        const cancelledUpdate: TaskStatusUpdateEvent = {
          kind: 'status-update',
          taskId: taskId,
          contextId: contextId,
          status: {
            state: "canceled",
            timestamp: new Date().toISOString(),
          },
          final: true, // Cancellation is a final state
        };
        eventBus.publish(cancelledUpdate);
        return;
      }
      const responseText = assistantText || '';
      console.info(`[MovieAgentExecutor] Prompt response: ${responseText}`);
      const lines = responseText.trim().split('\n');
      const finalStateLine = lines.at(-1)?.trim().toUpperCase();
      const agentReplyText = lines.slice(0, lines.length - 1).join('\n').trim();

      let finalA2AState: TaskState = "unknown";

      if (finalStateLine === 'COMPLETED') {
        finalA2AState = "completed";
      } else if (finalStateLine === 'AWAITING_USER_INPUT') {
        finalA2AState = "input-required";
      } else {
        console.warn(
          `[MovieAgentExecutor] Unexpected final state line from prompt: ${finalStateLine}. Defaulting to 'completed'.`
        );
        finalA2AState = "completed"; // Default if LLM deviates
      }

      // 5. Publish final task status update
      const agentMessage: Message = {
        kind: 'message',
        role: 'agent',
        messageId: uuidv4(),
        parts: [{ kind: 'text', text: agentReplyText || "Completed." }], // Ensure some text
        taskId: taskId,
        contextId: contextId,
      };
      historyForGenkit.push(agentMessage);
      contexts.set(contextId, historyForGenkit)

      const finalUpdate: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId: taskId,
        contextId: contextId,
        status: {
          state: finalA2AState,
          message: agentMessage,
          timestamp: new Date().toISOString(),
        },
        final: true,
      };
      eventBus.publish(finalUpdate);

      console.log(
        `[MovieAgentExecutor] Task ${taskId} finished with state: ${finalA2AState}`
      );

    } catch (error: any) {
      console.error(
        `[MovieAgentExecutor] Error processing task ${taskId}:`,
        error
      );
      const errorUpdate: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId: taskId,
        contextId: contextId,
        status: {
          state: "failed",
          message: {
            kind: 'message',
            role: 'agent',
            messageId: uuidv4(),
            parts: [{ kind: 'text', text: `Agent error: ${error.message}` }],
            taskId: taskId,
            contextId: contextId,
          },
          timestamp: new Date().toISOString(),
        },
        final: true,
      };
      eventBus.publish(errorUpdate);
    }
  }
}

// --- Server Setup ---

// Get agent name from environment variables
const agentName = process.env.AGENT_NAME || process.env.MOVIE_AGENT_NAME || 'Movie Agent';
// Prefer explicit base URL if provided (useful for deployments)
const agentUrl =
  process.env.MOVIE_AGENT_URL ||
  `http://${process.env.HOST || 'localhost'}:${process.env.PORT || 41241}/`;

const movieAgentCard: AgentCard = {
  name: agentName,
  description: 'An agent that can answer questions about movies and actors using TMDB.',
  // Adjust the base URL and port as needed. /a2a is the default base in A2AExpressApp
  url: agentUrl, 
  provider: {
    organization: 'OrgTrust.eth',
    url: 'https://www.richcanvas3.com' // Added provider URL
  },
  version: '0.0.4', // Incremented version
  protocolVersion: '0.3.0',
  capabilities: {
    streaming: true, // The new framework supports streaming
    pushNotifications: false, // Assuming not implemented for this agent yet
    stateTransitionHistory: true, // Agent uses history
  },
  // authentication: null, // Property 'authentication' does not exist on type 'AgentCard'.
  securitySchemes: undefined, // Or define actual security schemes if any
  security: undefined,
  defaultInputModes: ['text'],
  defaultOutputModes: ['text', 'task-status'], // task-status is a common output mode
  skills: [
    {
      id: 'general_movie_chat',
      name: 'General Movie Chat',
      description: 'Answer general questions or chat about movies, actors, directors.',
      tags: ['movies', 'actors', 'directors'],
      examples: [
        'Tell me about the plot of Inception.',
        'Recommend a good sci-fi movie.',
        'Who directed The Matrix?',
        'What other movies has Scarlett Johansson been in?',
        'Find action movies starring Keanu Reeves',
        'Which came out first, Jurassic Park or Terminator 2?',
      ],
      inputModes: ['text'], // Explicitly defining for skill
      outputModes: ['text', 'task-status'] // Explicitly defining for skill
    },
    {
      id: 'agent.feedback.requestAuth',
      name: 'agent.feedback.requestAuth',
      description: 'Issue a signed ERC-8004 feedbackAuth for a client to submit feedback',
      tags: ['erc8004', 'feedback', 'auth', 'a2a'],
      examples: [
        'Client requests feedbackAuth after receiving results',
      ],
      inputModes: ['text'],
      outputModes: ['text']
    },
  ],
  supportsAuthenticatedExtendedCard: false,
};

/**
 * Sets up and returns the Hono app for movie-agent
 * This function can be used both for local development and Cloudflare Workers
 */
export async function setupMovieAgentApp(opts?: { env?: MovieAgentRuntimeEnv }): Promise<Hono> {
  const ENV: MovieAgentRuntimeEnv = opts?.env ?? (typeof process !== 'undefined' ? (process.env as any) : {});
  RUNTIME_ENV = ENV;
  // Make env accessible to other modules (e.g., tools.js) in Cloudflare Workers runtime.
  (globalThis as any).MOVIE_AGENT_ENV = ENV;

  // Check environment variables (don't exit in Cloudflare Workers environment)
  if (!ENV.OPENAI_API_KEY || !ENV.TMDB_API_KEY) {
    console.error("OPENAI_API_KEY and TMDB_API_KEY environment variables are required");
    // Only exit for local Node dev server runs (RUN_SERVER=1)
    if (
      typeof process !== 'undefined' &&
      typeof process.env !== 'undefined' &&
      process.env.RUN_SERVER === '1' &&
      process.exit
    ) {
      process.exit(1);
    }
  }
  // Attempt to submit feedback via delegation on startup (expect giveFeedback event)
  try {
    console.info('***************  attempt to submit feedback via delegation (expect giveFeedback event) on startup')

    //const sp = buildDelegationSetup();
    //const agentId = sp.agentId;

    //await giveFeedbackWithDelegation({});

  } catch (err: any) {
    console.warn('[MovieAgent] giveFeedbackWithDelegation skipped:', err?.message || err);
  }

  // 1. Create TaskStore
  console.info("*************** create TaskStore");
  const taskStore: TaskStore = new InMemoryTaskStore();

  // 2. Create AgentExecutor
  console.info("*************** create AgentExecutor");
  const agentExecutor: AgentExecutor = new MovieAgentExecutor();

  // 3. Create DefaultRequestHandler
  console.info("*************** create DefaultRequestHandler");
  const requestHandler = new DefaultRequestHandler(
    movieAgentCard,
    taskStore,
    agentExecutor
  );

  // 4. Create and setup A2AHonoApp
  console.info("*************** create A2AHonoApp");
  const appBuilder = new A2AHonoApp(requestHandler);
  const corsOriginsEnv = (process.env.CORS_ORIGINS || '').trim();
  const allowedOrigins = (corsOriginsEnv || 'http://localhost:3000,http://localhost:4002,http://localhost:4003,http://localhost:4004,http://localhost:5173,http://movieclient.localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);

  console.info("*************** create Hono app");
  const app = new Hono();
  // If CORS_ORIGINS is not set, default to allow all origins (agent card is public).
  // If CORS_ORIGINS includes "*", allow all origins (dev-friendly).
  const allowAnyOrigin = !corsOriginsEnv || allowedOrigins.includes('*');
  app.use('/*', cors({
    // Hono CORS: prefer reflecting the request origin when allowing any origin.
    // This avoids some browser quirks and keeps `Vary: Origin` behavior consistent.
    origin: allowAnyOrigin ? (origin) => origin || '*' : allowedOrigins,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-A2A-Extensions'],
  }));
  console.info("*************** setup routes");
  const honoApp = appBuilder.setupRoutes(app, "", ".well-known/agent.json");
  
  // Add catch-all route to ensure all requests return a Response
  honoApp.all('*', (c) => {
    return c.json({ error: 'Not Found' }, 404);
  });

  // 4.5. Agent card endpoint is handled automatically by A2AExpressApp.setupRoutes()
  // No need for custom endpoint - A2AExpressApp serves it from the requestHandler

  // 4.6. Add feedback auth endpoint
  console.info("*************** add feedback auth endpoint");
  honoApp.get('/api/feedback-auth/:clientAddress', async (c) => {
    try {
      const clientAddress = c.req.param('clientAddress');
      const feedbackAuthId = await serverGetFeedbackAuthId({ clientAddress });
      return c.json({ feedbackAuthId });
    } catch (error: any) {
      console.error('[MovieAgent] Error getting feedback auth ID:', error?.message || error);
      return c.json({ error: error?.message || 'Internal server error' }, 500);
    }
  });

  // AP2: minimal quote endpoint
  const getServerWallet = () => {
    const pk = (process.env.MOVIE_AGENT_OPERATOR_KEY || process.env.SERVER_PRIVATE_KEY || '').trim();
    if (!pk || !pk.startsWith('0x')) throw new Error('SERVER_PRIVATE_KEY not set for AP2 signing');
    return new ethers.Wallet(pk);
  };

  honoApp.post('/ap2/quote', async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const { capability = 'summarize:v1' } = body || {};
      const agent = String(process.env.MOVIE_AGENT_ADDRESS || '0x0000000000000000000000000000000000000000');
      const chainIdHex = (process.env.ERC8004_CHAIN_HEX || '0xaa36a7') as `0x${string}`;

      const quote: PaymentQuote = {
        quoteId: randomUUID(),
        agent,
        capability,
        unit: 'call',
        rate: String(process.env.AP2_RATE || '0.001'),
        token: String(process.env.AP2_TOKEN || 'ETH'),
        chainId: chainIdHex,
        expiresAt: Date.now() + 5 * 60 * 1000,
        termsCid: process.env.AP2_TERMS_CID || undefined,
      };
      const wallet = getServerWallet();
      const msg = JSON.stringify(quote);
      const sig = await wallet.signMessage(ethers.getBytes(ethers.hashMessage(msg)));
      quote.agentSig = sig;
      return c.json(quote);
    } catch (e: any) {
      return c.json({ error: e?.message || 'Failed to produce quote' }, 400);
    }
  });

  // AP2: minimal invoke endpoint
  honoApp.post('/ap2/invoke', async (c) => {
    try {
      const env: AgentCallEnvelope = await c.req.json();
      if (!env?.payment?.intent) throw new Error('missing payment intent');

      const intent: PaymentIntent = env.payment.intent;
      const msg = JSON.stringify({
        quoteId: intent.quoteId,
        payer: intent.payer,
        mode: intent.mode,
        maxSpend: intent.maxSpend,
        nonce: intent.nonce,
        deadline: intent.deadline,
      });

      const recovered = ethers.verifyMessage(ethers.getBytes(ethers.hashMessage(msg)), intent.signature);
      if (!recovered || recovered.toLowerCase() !== String(intent.payer).toLowerCase()) {
        throw new Error('invalid intent signature');
      }

      const meteredUnits = 1;
      const rate = Number(process.env.AP2_RATE || '0.001');
      const amount = (meteredUnits * rate).toString();
      const hashResult = createHash('sha256').update(JSON.stringify(env.payload || {}));
      const requestHash = await hashResult.digest('hex');
      const receipt: PaymentReceipt = {
        requestHash: `0x${requestHash}` as `0x${string}`,
        meteredUnits,
        amount,
        token: String(process.env.AP2_TOKEN || 'ETH'),
        chainId: (process.env.ERC8004_CHAIN_HEX || '0xaa36a7') as `0x${string}`,
        settlementRef: undefined,
        agentSig: '',
      };
      const wallet = getServerWallet();
      const sig = await wallet.signMessage(ethers.getBytes(ethers.hashMessage(JSON.stringify(receipt))));
      receipt.agentSig = sig;

      return c.json({ ok: true, receipt, result: { message: 'capability executed' } });
    } catch (e: any) {
      return c.json({ error: e?.message || 'invoke failed' }, 400);
    }
  });

  // 4.6. Add A2A skill HTTP shim: agent.feedback.requestAuth
  // POST /a2a/skills/agent.feedback.requestAuth
  honoApp.post('/a2a/skills/agent.feedback.requestAuth', async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      console.info(`************ [MovieAgent] requestAuthabc123qqq: ${JSON.stringify(body)}`);
      // Expected request body parameters (matching agentAdapter.ts function signature):
      // - clientAddress (required): string - Client's Ethereum address
      // - chainId (required): number - Chain ID (defaults to 11155111 for Sepolia)
      // - indexLimit (required): number - Maximum index for feedback auth (will be converted to BigInt)
      // - expirySeconds (required): number - Expiration time in seconds (defaults to 3600)
      // - agentId (required): string - Agent ID as string (will be converted to BigInt)
      // - taskRef (required): string - Task reference identifier
      const { agentId, clientAddress, taskRef, chainId, expirySeconds, expiry, indexLimit } = body || {};
      
      // Validate required parameters
      if (!clientAddress) {
        return c.json({ error: 'clientAddress is required' }, 400);
      }
      if (!agentId) {
        return c.json({ error: 'agentId is required' }, 400);
      }
      if (!taskRef) {
        return c.json({ error: 'taskRef is required' }, 400);
      }
      
      // Support both 'expiry' and 'expirySeconds' for backward compatibility
      const expirySec = expirySeconds ?? expiry;

      console.info("........... request feedback auth ........: ", agentId, clientAddress, taskRef, chainId)
      const result = await requestFeedbackAuth({
        agentId: BigInt(agentId),
        clientAddress: clientAddress as `0x${string}`,
        taskRef,
        chainId,
        expirySeconds: expirySec,
        indexLimit: indexLimit ? BigInt(indexLimit) : undefined,
      });
      console.info("........... request feedback auth result ........: ", result);
      // Convert result to JSON-safe format (BigInt values are already strings in the result)
      return c.json({
        feedbackAuthId: result.signature,
        signature: result.signature,
        signerAddress: result.signerAddress
      });
    } catch (error: any) {
      console.error('[MovieAgent] requestAuth error:', error?.message || error);
      return c.json({ error: error?.message || 'Internal server error' }, 500);
    }
  });

  return honoApp;
}

async function main() {
  const app = await setupMovieAgentApp();

  // 5. Start the server (only for local development)
  // For Hono, we need to use a Node.js HTTP server adapter
  console.info("*************** start the server");
  const PORT = Number(process.env.PORT) || 41241;
  const HOST = process.env.HOST || '0.0.0.0';
  
  // Import Node.js http server for local dev (only in Node.js, not Workers)
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      const { serve } = await import('@hono/node-server');
      serve({
        fetch: app.fetch,
        port: PORT,
        hostname: HOST,
      }, (info) => {
        const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
        console.log(`[MovieAgent] Server using Hono started on http://${displayHost}:${PORT}`);
        console.log(`[MovieAgent] Agent: http://${displayHost}:${PORT}/.well-known/agent.json`);
        console.log('[MovieAgent] Press Ctrl+C to stop the server');
      });
    } catch (e) {
      console.error('[MovieAgent] Failed to start server:', e);
      process.exit(1);
    }
  } else {
    console.warn('[MovieAgent] Node.js server not available - this is likely Cloudflare Workers');
  }
}

// IMPORTANT:
// This file is imported by Cloudflare Workers (`cloudflare.ts`). With `nodejs_compat`,
// Cloudflare provides a `process` shim, so `process.versions.node` may exist.
// We must NOT auto-start a local Node HTTP server in Workers.
//
// For local dev, run with RUN_SERVER=1 (wired up in package.json scripts).
const SHOULD_RUN_MAIN =
  typeof process !== "undefined" &&
  typeof process.env !== "undefined" &&
  process.env.RUN_SERVER === "1";

if (SHOULD_RUN_MAIN) {
  main().catch(console.error);
}

