import "dotenv/config";
import express from "express";
import { v4 as uuidv4 } from 'uuid';
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import cors from "cors";
import { randomUUID, createHash } from 'crypto';
import { ethers } from 'ethers';
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
  A2AExpressApp,
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
  DefaultRequestHandler,
} from "@a2a-js/sdk/server";
import { openAiToolDefinitions, openAiToolHandlers } from "./tools.js";
import { giveFeedbackWithDelegation, getFeedbackAuthId as serverGetFeedbackAuthId, requestFeedbackAuth } from './agentAdapter.js';
import { buildDelegationSetup } from './session.js';

if (!process.env.OPENAI_API_KEY || !process.env.TMDB_API_KEY) {
  console.error("OPENAI_API_KEY and TMDB_API_KEY environment variables are required")
  process.exit(1);
}

// Simple store for contexts
const contexts: Map<string, Message[]> = new Map();

// Load and render system prompt from file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const promptPath = path.join(__dirname, "movie_agent.prompt");

function renderSystemPrompt(goal?: string): string {
  const raw = fs.readFileSync(promptPath, "utf-8");
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
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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

const movieAgentCard: AgentCard = {
  name: 'Movie Agent',
  description: 'An agent that can answer questions about movies and actors using TMDB.',
  // Adjust the base URL and port as needed. /a2a is the default base in A2AExpressApp
  url: 'http://localhost:41241/', // Example: if baseUrl in A2AExpressApp 
  provider: {
    organization: 'A2A Samples',
    url: 'https://example.com/a2a-samples' // Added provider URL
  },
  version: '0.0.2', // Incremented version
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

async function main() {
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

  // 4. Create and setup A2AExpressApp
  console.info("*************** create A2AExpressApp");
  const appBuilder = new A2AExpressApp(requestHandler);
  const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://movieclient.localhost:3000')
    .split(',')
    .map(o => o.trim())
    .filter(o => o.length > 0);

  console.info("*************** create express app");
  const app = express() as any;
  app.use(cors({ origin: allowedOrigins }));
  console.info("*************** setup routes");
  const expressApp = appBuilder.setupRoutes(app);

  // 4.5. Add static agent card endpoint
  console.info("*************** add static agent card endpoint");
  expressApp.get('/.well-known/agent-card.json', (req: any, res: any) => {
    try {
      const agentCardPath = path.join(__dirname, 'agent-card.json');
      const agentCard = JSON.parse(fs.readFileSync(agentCardPath, 'utf8'));
      res.json(agentCard);
    } catch (error) {
      console.error('Error serving agent card:', error);
      res.status(500).json({ error: 'Failed to load agent card' });
    }
  });

  // 4.6. Add feedback auth endpoint
  console.info("*************** add feedback auth endpoint");
  expressApp.get('/api/feedback-auth/:clientAddress', async (req: any, res: any) => {
    try {
      const { clientAddress } = req.params;
      const feedbackAuthId = await serverGetFeedbackAuthId({ clientAddress });
      res.json({ feedbackAuthId });
    } catch (error: any) {
      console.error('[MovieAgent] Error getting feedback auth ID:', error?.message || error);
      res.status(500).json({ error: error?.message || 'Internal server error' });
    }
  });

  // AP2: minimal quote endpoint
  const getServerWallet = () => {
    const pk = (process.env.MOVIE_AGENT_OPERATOR_KEY || process.env.SERVER_PRIVATE_KEY || '').trim();
    if (!pk || !pk.startsWith('0x')) throw new Error('SERVER_PRIVATE_KEY not set for AP2 signing');
    return new ethers.Wallet(pk);
  };

  expressApp.post('/ap2/quote', async (req: any, res: any) => {
    try {
      const { capability = 'summarize:v1' } = req.body || {};
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
      res.json(quote);
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'Failed to produce quote' });
    }
  });

  // AP2: minimal invoke endpoint
  expressApp.post('/ap2/invoke', async (req: any, res: any) => {
    try {
      const env: AgentCallEnvelope = req.body;
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
      const requestHash = createHash('sha256').update(JSON.stringify(env.payload || {})).digest('hex');
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

      res.json({ ok: true, receipt, result: { message: 'capability executed' } });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'invoke failed' });
    }
  });

  // 4.6. Add A2A skill HTTP shim: agent.feedback.requestAuth
  // POST /a2a/skills/agent.feedback.requestAuth
  expressApp.post('/a2a/skills/agent.feedback.requestAuth', async (req: any, res: any) => {
    try {
      const { agentId, clientAddress, taskRef, chainId, expiry, indexLimit } = req.body || {};
      if (!clientAddress) return res.status(400).json({ error: 'clientAddress required' });
      const result = await requestFeedbackAuth({
        agentId: agentId ? BigInt(agentId) : undefined,
        clientAddress,
        taskRef,
        chainId,
        expirySeconds: expiry,
        indexLimit: indexLimit ? BigInt(indexLimit) : undefined,
      });
      res.json(result);
    } catch (error: any) {
      console.error('[MovieAgent] requestAuth error:', error?.message || error);
      res.status(500).json({ error: error?.message || 'Internal server error' });
    }
  });

  // 5. Start the server
  console.info("*************** start the server");
  const PORT = Number(process.env.PORT) || 41241;
  const HOST = process.env.HOST || 'movieagent.localhost';
  expressApp.listen(PORT, HOST, () => {
    console.log(`[MovieAgent] Server using new framework started on http://${HOST}:${PORT}`);
    console.log(`[MovieAgent] Agent Card: http://${HOST}:${PORT}/.well-known/agent-card.json`);
    console.log('[MovieAgent] Press Ctrl+C to stop the server');
  });
}

main().catch(console.error);

