/**
 * Hono adapter for A2A SDK Express handlers
 * Converts Express.js handlers to Hono-compatible handlers
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { A2ARequestHandler } from '@a2a-js/sdk/server';
import { JsonRpcTransportHandler, ServerCallContext, UnauthenticatedUser, A2AError } from '@a2a-js/sdk/server';
import { Extensions, HTTP_EXTENSION_HEADER } from '@a2a-js/sdk';
import type { AgentCard } from '@a2a-js/sdk';

// SSE constants and formatters (replicated from SDK internals)
const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
};

function formatSSEEvent(data: any): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function formatSSEErrorEvent(data: any): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

type UserBuilder = (req: Request) => Promise<any>;
const UserBuilder = {
  noAuthentication: () => Promise.resolve(new UnauthenticatedUser())
};

/**
 * Convert Express Request to a format compatible with A2A SDK
 */
function createServerCallContext(req: Request, userBuilder: UserBuilder): Promise<ServerCallContext> {
  return userBuilder(req).then(user => {
    const serviceParam = req.headers.get(HTTP_EXTENSION_HEADER);
    return new ServerCallContext(
      Extensions.parseServiceParameter(serviceParam || undefined),
      user ?? new UnauthenticatedUser()
    );
  });
}

/**
 * Hono handler for JSON-RPC A2A requests
 */
export function createJsonRpcHandler(options: { requestHandler: A2ARequestHandler; userBuilder: UserBuilder }) {
  const jsonRpcTransportHandler = new JsonRpcTransportHandler(options.requestHandler);
  
  return async (c: Context) => {
    let body: any = {};
    try {
      body = await c.req.json().catch(() => ({}));
    } catch (e) {
      // If JSON parsing fails, body stays as {}
    }
    
    try {
      const user = await options.userBuilder(c.req.raw);
      const context = new ServerCallContext(
        Extensions.parseServiceParameter(c.req.header(HTTP_EXTENSION_HEADER)),
        user ?? new UnauthenticatedUser()
      );
      
      const rpcResponseOrStream = await jsonRpcTransportHandler.handle(body, context);
      
      if (context.activatedExtensions) {
        c.header(HTTP_EXTENSION_HEADER, Array.from(context.activatedExtensions).join(','));
      }
      
      if (typeof rpcResponseOrStream?.[Symbol.asyncIterator] === "function") {
        // SSE streaming
        const stream = rpcResponseOrStream;
        
        const streamResponse = new ReadableStream({
          async start(controller) {
            try {
              for await (const event of stream) {
                const text = formatSSEEvent(event);
                controller.enqueue(new TextEncoder().encode(text));
              }
            } catch (streamError) {
              console.error(`Error during SSE streaming (request ${body?.id}):`, streamError);
              const a2aError = streamError instanceof A2AError 
                ? streamError 
                : A2AError.internalError(streamError instanceof Error ? streamError.message : "Streaming error.");
              const errorResponse = {
                jsonrpc: "2.0",
                id: body?.id || null,
                error: a2aError.toJSONRPCError()
              };
              const text = formatSSEErrorEvent(errorResponse);
              controller.enqueue(new TextEncoder().encode(text));
            } finally {
              controller.close();
            }
          }
        });
        
        // Build headers object
        const headers = new Headers();
        Object.entries(SSE_HEADERS).forEach(([key, value]) => {
          headers.set(key, value);
        });
        
        return new Response(streamResponse, { headers });
      } else {
        // Regular JSON response
        return c.json(rpcResponseOrStream);
      }
    } catch (error) {
      console.error("Unhandled error in JSON-RPC POST handler:", error);
      const a2aError = error instanceof A2AError 
        ? error 
        : A2AError.internalError("General processing error.");
      const errorResponse = {
        jsonrpc: "2.0",
        id: body?.id || null,
        error: a2aError.toJSONRPCError()
      };
      return c.json(errorResponse, 500);
    }
  };
}

/**
 * Hono handler for agent card requests
 */
export function createAgentCardHandler(options: { agentCardProvider: { getAgentCard(): Promise<AgentCard> } | (() => Promise<AgentCard>) }) {
  const provider = typeof options.agentCardProvider === "function" 
    ? options.agentCardProvider 
    : options.agentCardProvider.getAgentCard.bind(options.agentCardProvider);
  
  return async (c: Context) => {
    try {
      const agentCard = await provider();
      const origin = new URL(c.req.url).origin;
      const baseUrl = origin.endsWith("/") ? origin : `${origin}/`;
      const pathname = new URL(c.req.url).pathname;
      const isLegacyAgentJson = pathname.endsWith('/.well-known/agent.json');

      const supportedInterfaces = Array.isArray((agentCard as any)?.supportedInterfaces)
        ? (agentCard as any).supportedInterfaces.map((iface: any) => {
            const u = String(iface?.url || '').trim();
            // Allow relative URLs in the provider (recommended) and rewrite them against request origin.
            if (u.startsWith('/')) return { ...iface, url: `${origin}${u}` };
            return iface;
          })
        : undefined;

      // v1.0 AgentCard does NOT include a top-level `url`.
      // Keep it ONLY for the legacy `agent.json` endpoint to avoid breaking older readers.
      const basePayload: any = { ...(agentCard as any), ...(supportedInterfaces ? { supportedInterfaces } : {}) };

      if (isLegacyAgentJson) {
        // Compatibility: some older clients require top-level `url` as the service endpoint.
        // Prefer the first supported interface URL (rewritten to absolute), otherwise fall back to origin.
        const preferredEndpoint =
          (supportedInterfaces && supportedInterfaces[0] && String(supportedInterfaces[0].url || '').trim()) || baseUrl;
        basePayload.url = preferredEndpoint;
      } else {
        delete basePayload.url;
      }

      return c.json(basePayload);
    } catch (error) {
      console.error("Error fetching agent card:", error);
      return c.json({ error: "Failed to retrieve agent card" }, 500);
    }
  };
}

/**
 * Hono adapter for A2A SDK
 * Similar to A2AExpressApp but for Hono
 */
export class A2AHonoApp {
  private requestHandler: A2ARequestHandler;
  private userBuilder: UserBuilder;
  
  constructor(requestHandler: A2ARequestHandler, userBuilder: UserBuilder = UserBuilder.noAuthentication) {
    this.requestHandler = requestHandler;
    this.userBuilder = userBuilder;
  }
  
  /**
   * Sets up A2A routes on a Hono app
   */
  setupRoutes(app: Hono, baseUrl: string = "", agentCardPath: string = ".well-known/agent-card.json"): Hono {
    // If baseUrl is empty, add routes directly to app
    if (!baseUrl) {
      // JSON-RPC handler at root
      app.post("/", createJsonRpcHandler({
        requestHandler: this.requestHandler,
        userBuilder: this.userBuilder
      }));
      
      // Agent card handler
      app.get(`/${agentCardPath}`, createAgentCardHandler({
        agentCardProvider: this.requestHandler
      }));
    } else {
      // Use router for non-root baseUrl
      const router = new Hono();
      
      // JSON-RPC handler
      router.post("/", createJsonRpcHandler({
        requestHandler: this.requestHandler,
        userBuilder: this.userBuilder
      }));
      
      // Agent card handler
      router.get(`/${agentCardPath}`, createAgentCardHandler({
        agentCardProvider: this.requestHandler
      }));
      
      // Mount router at baseUrl
      app.route(baseUrl, router);
    }
    
    return app;
  }
}

