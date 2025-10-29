import { v4 as uuidv4 } from 'uuid';
import { randomUUID, createHash } from 'crypto';
import { ethers } from 'ethers';
import OpenAI from "openai";
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

// Simple store for contexts (in production, use Cloudflare KV or Durable Objects)
const contexts: Map<string, Message[]> = new Map();

// Load and render system prompt from file
function renderSystemPrompt(goal?: string): string {
  const raw = `You are a helpful movie agent that can answer questions about movies, actors, directors, and other film-related topics using The Movie Database (TMDB) API.

You have access to the following tools:
- searchMovies: Search for movies by title
- searchPeople: Search for people (actors, directors, etc.) by name

When answering questions:
1. Use the appropriate tools to gather information
2. Provide comprehensive and accurate responses
3. Include relevant details like release dates, ratings, cast, etc.
4. Be conversational and helpful

Current time: {{now}}

{{#if goal}}
User's goal: {{goal}}
{{/if}}

Always end your response with one of these states on a new line:
- COMPLETED (if you've fully answered the question)
- AWAITING_USER_INPUT (if you need more information from the user)`;

  const nowStr = new Date().toISOString();
  let content = raw.replaceAll("{{now}}", nowStr);

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
    const contextId = userMessage.contextId || existingTask?.contextId || uuidv4();

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
        history: [userMessage],
        metadata: userMessage.metadata,
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
          final: true,
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
        finalA2AState = "completed";
      }

      // 5. Publish final task status update
      const agentMessage: Message = {
        kind: 'message',
        role: 'agent',
        messageId: uuidv4(),
        parts: [{ kind: 'text', text: agentReplyText || "Completed." }],
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

// Agent Card definition
const movieAgentCard: AgentCard = {
  name: 'Movie Agent',
  description: 'An agent that can answer questions about movies and actors using TMDB.',
  url: 'https://movieagent.orgtrust.eth',
  provider: {
    organization: 'A2A Samples',
    url: 'https://example.com/a2a-samples'
  },
  version: '0.0.2',
  capabilities: {
    streaming: true,
    pushNotifications: false,
    stateTransitionHistory: true,
  },
  securitySchemes: undefined,
  security: undefined,
  defaultInputModes: ['text'],
  defaultOutputModes: ['text', 'task-status'],
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
      inputModes: ['text'],
      outputModes: ['text', 'task-status']
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

export async function createMovieAgentApp(env: any) {
  // Create TaskStore
  const taskStore: TaskStore = new InMemoryTaskStore();

  // Create AgentExecutor
  const agentExecutor: AgentExecutor = new MovieAgentExecutor();

  // Create DefaultRequestHandler
  const requestHandler = new DefaultRequestHandler(
    movieAgentCard,
    taskStore,
    agentExecutor
  );

  // Create and setup A2AExpressApp
  const appBuilder = new A2AExpressApp(requestHandler);
  
  // Create a simple request handler for Cloudflare Pages Functions
  return {
    async fetch(request: Request, env: any, ctx: any) {
      const url = new URL(request.url);
      
      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 200,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          },
        });
      }

      // Handle agent card endpoint
      if (url.pathname === '/.well-known/agent-card.json') {
        try {
          const agentCard = {
            name: "movieagent.orgtrust.eth",
            description: "movie agent description ....",
            url: "https://movieagent.orgtrust.eth",
            version: "0.0.2",
            skills: [
              {
                id: "general_movie_chat",
                name: "General Movie Chat",
                tags: [],
                examples: [],
                inputModes: [],
                outputModes: [],
                description: ""
              },
              {
                id: "agent.feedback.requestAuth",
                name: "agent.feedback.requestAuth",
                tags: ["erc8004","feedback","auth","a2a"],
                examples: ["Client requests feedbackAuth after receiving results"],
                inputModes: ["text"],
                outputModes: ["text"],
                description: "Issue a signed ERC-8004 feedbackAuth for a client to submit feedback"
              }
            ],
            registrations: [
              {
                agentId: 11,
                agentAddress: "eip155:11155111:0x80fAA3740fDb03D7536C7fEef94f6F34Ea932bd3",
                signature: "0x4d6ff18c69d1306363b4728dfecbf6f71c552936c8cb3c5b47d255f0f20719f042e25d6b70258856a91c1c9c07ab7cb5ee5402fe0c6ff39109f2b63329993afe1b"
              }
            ],
            trustModels: ["feedback"],
            capabilities: {
              streaming: false,
              pushNotifications: false,
              stateTransitionHistory: false
            },
            defaultInputModes: [],
            defaultOutputModes: [],
            supportsAuthenticatedExtendedCard: false,
            feedbackDataURI: ""
          };
          return new Response(JSON.stringify(agentCard), {
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        } catch (error) {
          console.error('Error serving agent card:', error);
          return new Response(JSON.stringify({ error: 'Failed to load agent card' }), {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }
      }

      // Handle feedback auth endpoint
      if (url.pathname.startsWith('/api/feedback-auth/')) {
        try {
          const clientAddress = url.pathname.split('/').pop();
          if (!clientAddress) {
            return new Response(JSON.stringify({ error: 'Client address required' }), {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            });
          }
          
          const feedbackAuthId = await serverGetFeedbackAuthId({ clientAddress });
          return new Response(JSON.stringify({ feedbackAuthId }), {
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        } catch (error: any) {
          console.error('[MovieAgent] Error getting feedback auth ID:', error?.message || error);
          return new Response(JSON.stringify({ error: error?.message || 'Internal server error' }), {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }
      }

      // Handle AP2 quote endpoint
      if (url.pathname === '/ap2/quote' && request.method === 'POST') {
        try {
          const body = await request.json();
          const { capability = 'summarize:v1' } = body || {};
          const agent = String(env.MOVIE_AGENT_ADDRESS || '0x0000000000000000000000000000000000000000');
          const chainIdHex = (env.ERC8004_CHAIN_HEX || '0xaa36a7') as `0x${string}`;

          const quote: PaymentQuote = {
            quoteId: randomUUID(),
            agent,
            capability,
            unit: 'call',
            rate: String(env.AP2_RATE || '0.001'),
            token: String(env.AP2_TOKEN || 'ETH'),
            chainId: chainIdHex,
            expiresAt: Date.now() + 5 * 60 * 1000,
            termsCid: env.AP2_TERMS_CID || undefined,
          };
          
          const pk = (env.MOVIE_AGENT_OPERATOR_KEY || env.SERVER_PRIVATE_KEY || '').trim();
          if (!pk || !pk.startsWith('0x')) {
            throw new Error('SERVER_PRIVATE_KEY not set for AP2 signing');
          }
          const wallet = new ethers.Wallet(pk);
          const msg = JSON.stringify(quote);
          const sig = await wallet.signMessage(ethers.getBytes(ethers.hashMessage(msg)));
          quote.agentSig = sig;
          
          return new Response(JSON.stringify(quote), {
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e?.message || 'Failed to produce quote' }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }
      }

      // Handle AP2 invoke endpoint
      if (url.pathname === '/ap2/invoke' && request.method === 'POST') {
        try {
          const env_data: AgentCallEnvelope = await request.json();
          if (!env_data?.payment?.intent) {
            throw new Error('missing payment intent');
          }

          const intent: PaymentIntent = env_data.payment.intent;
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
          const rate = Number(env.AP2_RATE || '0.001');
          const amount = (meteredUnits * rate).toString();
          const requestHash = createHash('sha256').update(JSON.stringify(env_data.payload || {})).digest('hex');
          const receipt: PaymentReceipt = {
            requestHash: `0x${requestHash}` as `0x${string}`,
            meteredUnits,
            amount,
            token: String(env.AP2_TOKEN || 'ETH'),
            chainId: (env.ERC8004_CHAIN_HEX || '0xaa36a7') as `0x${string}`,
            settlementRef: undefined,
            agentSig: '',
          };
          
          const pk = (env.MOVIE_AGENT_OPERATOR_KEY || env.SERVER_PRIVATE_KEY || '').trim();
          if (!pk || !pk.startsWith('0x')) {
            throw new Error('SERVER_PRIVATE_KEY not set for AP2 signing');
          }
          const wallet = new ethers.Wallet(pk);
          const sig = await wallet.signMessage(ethers.getBytes(ethers.hashMessage(JSON.stringify(receipt))));
          receipt.agentSig = sig;

          return new Response(JSON.stringify({ ok: true, receipt, result: { message: 'capability executed' } }), {
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e?.message || 'invoke failed' }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }
      }

      // Handle A2A skill HTTP shim: agent.feedback.requestAuth
      if (url.pathname === '/a2a/skills/agent.feedback.requestAuth' && request.method === 'POST') {
        try {
          const body = await request.json();
          const { agentId, clientAddress, taskRef, chainId, expiry, indexLimit } = body || {};
          if (!clientAddress) {
            return new Response(JSON.stringify({ error: 'clientAddress required' }), {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            });
          }
          
          const result = await requestFeedbackAuth({
            agentId: agentId ? BigInt(agentId) : undefined,
            clientAddress,
            taskRef,
            chainId,
            expirySeconds: expiry,
            indexLimit: indexLimit ? BigInt(indexLimit) : undefined,
          });
          
          return new Response(JSON.stringify(result), {
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        } catch (error: any) {
          console.error('[MovieAgent] requestAuth error:', error?.message || error);
          return new Response(JSON.stringify({ error: error?.message || 'Internal server error' }), {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }
      }

      // Handle A2A endpoints
      if (url.pathname.startsWith('/a2a/')) {
        // For now, return a simple response for A2A endpoints
        // In a full implementation, you'd integrate with the A2AExpressApp
        return new Response(JSON.stringify({ 
          message: 'A2A endpoint - full integration needed',
          path: url.pathname 
        }), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      // Default response
      return new Response(JSON.stringify({ 
        message: 'Movie Agent API',
        endpoints: [
          '/.well-known/agent-card.json',
          '/api/feedback-auth/:clientAddress',
          '/ap2/quote',
          '/ap2/invoke',
          '/a2a/skills/agent.feedback.requestAuth',
          '/a2a/*'
        ]
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  };
}
