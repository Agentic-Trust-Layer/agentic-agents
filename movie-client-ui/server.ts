#!/usr/bin/env node

import "dotenv/config";
import express from "express";
import { fileURLToPath } from 'url';
import path from 'path';
import { acceptFeedbackWithDelegation, addFeedback } from "../src/agents/movie-agent/agentAdapter.js";
import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, http } from 'viem';
import { reputationRegistryAbi } from "../src/lib/abi/reputationRegistry.js";
import { discoverAgents, type DiscoverRequest } from '@agentic-trust/core/server';
import { getAgenticTrustClient, buildAgentDetail, getReputationClient } from '@agentic-trust/core/server';
import IpfsService from '../src/services/ipfs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.BACKEND_PORT) || 3000;
const HOST = process.env.HOST || 'localhost';

// Middleware
app.use(express.json());

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Helper: resolve feedbackAuth from agent name + client address via identity registry & agent card skill
async function resolveFeedbackAuth(params: { clientAddress: string; agentName: string; taskRef?: string; indexLimit?: number; expirySec?: number }): Promise<string> {
  const { clientAddress, agentName, taskRef } = params;
  const indexLimit = params.indexLimit ?? 1;
  const expiry = params.expirySec ?? Number(process.env.ERC8004_FEEDBACKAUTH_TTL_SEC || 3600);

  // Always try ENS resolution first (for production/registered agents)
  const rpcUrl = (process.env.RPC_URL || process.env.JSON_RPC_URL || 'https://rpc.sepolia.org');
  const pub = createPublicClient({ chain: undefined as any, transport: http(rpcUrl) });
  const repReg = (process.env.REPUTATION_REGISTRY || process.env.ERC8004_REPUTATION_REGISTRY || '').trim();
  if (!repReg) throw new Error('REPUTATION_REGISTRY is required to resolve identity registry');

  // Use buildAgentDetail to get all agent information
  // Check if discovery URL is configured
  const discoveryUrl = (process.env.AGENTIC_TRUST_DISCOVERY_URL || '').trim();
  if (!discoveryUrl) {
    throw new Error('AGENTIC_TRUST_DISCOVERY_URL environment variable is required for agent discovery');
  }

  // Remove '.8004-agent.eth' suffix from agent name before searching
  const searchAgentName = agentName.replace(/\.8004-agent\.eth$/, '');
  
  let agentDetail;
  let agentUrl: string | undefined;
  let agentIdResolved: bigint | undefined;

  try {
    console.info(`************ [MovieClientUI] searchAgents: ${agentName}`);
    const client2 = await getAgenticTrustClient();
    const result = await client2.agents.searchAgents({
      query: agentName,
      page: 1,
      pageSize: 1
    });

    // Find the matching agent from discovery results (match both original and stripped name)
    // Log only safe properties to avoid circular reference errors
    console.info(`************ [MovieClientUI] searchAgents result - total: ${result?.total}, agents count: ${result?.agents?.length || 0}`);
    const discoveredAgent = result.agents?.find((agent: any) => 
      agent.agentName === agentName || agent.name === agentName ||
      agent.agentName === searchAgentName || agent.name === searchAgentName
    );
    
    if (!discoveredAgent) {
      throw new Error(`Agent not found in discovery: ${agentName}`);
    }

    console.info(`************ [MovieClientUI] discoveredAgent.agentId: `, discoveredAgent.agentId);
    
    // Get agent ID from discovery result (AgentInfo has agentId as string)
    const discoveredAgentId = discoveredAgent.agentId;
    if (!discoveredAgentId) {
      throw new Error(`Agent ID not found in discovery result for: ${agentName}`);
    }
    
    console.info(`[MovieClientUI] Found agent ID from discovery: ${discoveredAgentId}`);
    
    // Set agentIdResolved immediately from discovery result (required, not optional)
    agentIdResolved = BigInt(discoveredAgentId);
    
    // Use the discovered agent ID to build agent detail
    const client = await getAgenticTrustClient();

    const agentIdString = discoveredAgentId.toString();
    agentDetail = await buildAgentDetail(client, agentIdString);
    // Log agentDetail without circular references (avoid JSON.stringify on objects with circular refs)
    console.info(`************ [MovieClientUI] Agent Detail - agentId: ${agentDetail?.agentId}, agentName: ${agentDetail?.agentName}, endpoints: ${JSON.stringify(agentDetail?.endpoints || [])}`);

    // Extract A2A endpoint from endpoints array (preferred)
    // Check root-level endpoints array first
    if (agentDetail.endpoints && Array.isArray(agentDetail.endpoints)) {
      const a2aEndpoint = agentDetail.endpoints.find((ep: any) => ep.name === 'A2A');
      if (a2aEndpoint?.endpoint) {
        // Extract base URL from endpoint (remove /.well-known/agent-card.json if present)
        agentUrl = a2aEndpoint.endpoint.replace(/\/\.well-known\/agent-card\.json\/?$/, '');
      }
    }
    
    // Fallback to identityRegistration.registration.endpoints
    if (!agentUrl && agentDetail.identityRegistration?.registration?.endpoints) {
      const a2aEndpoint = agentDetail.identityRegistration.registration.endpoints.find((ep: any) => ep.name === 'A2A');
      if (a2aEndpoint?.endpoint) {
        // Extract base URL from endpoint (remove /.well-known/agent-card.json if present)
        agentUrl = a2aEndpoint.endpoint.replace(/\/\.well-known\/agent-card\.json\/?$/, '');
      }
    }
    console.info(`[MovieClientUI] Agent URL from buildAgentDetail: ${agentUrl}`);
    
    // Fallback to direct properties
    if (!agentUrl) {
      agentUrl = agentDetail.a2aEndpoint || agentDetail.ensEndpoint || agentDetail.agentAccountEndpoint || undefined;
    }
    // Update agentIdResolved from agentDetail if available (should match discoveredAgentId)
    if (agentDetail.agentId) {
      agentIdResolved = BigInt(agentDetail.agentId);
    }
    console.info(`[MovieClientUI] Agent URL from buildAgentDetail: ${agentUrl}, Agent ID: ${agentIdResolved}`);
  } catch (error: any) {
    // Log error message only, avoid logging the full error object which might contain circular refs
    const errorMsg = error?.message || String(error);
    console.warn(`[MovieClientUI] buildAgentDetail failed: ${errorMsg}`);
    // Only log stack if it's a string (not an object with circular refs)
    if (error?.stack && typeof error.stack === 'string') {
      console.warn(`[MovieClientUI] buildAgentDetail error stack: ${error.stack.substring(0, 500)}`);
    }
    // If agentIdResolved was set before the error, keep it; otherwise throw
    if (!agentIdResolved) {
      throw new Error(`Failed to resolve agent ID for ${agentName}: ${errorMsg}`);
    }
  }

  // If buildAgentDetail fails, fall back to AGENT_URL (for local development)
  if (!agentUrl) {
    const directAgentUrl = (process.env.AGENT_URL || process.env.MOVIE_AGENT_URL || '').trim();
    if (directAgentUrl) {
      console.info(`[MovieClientUI] Using direct agent URL fallback bbbb: ${directAgentUrl}`);
      agentUrl = directAgentUrl;
    } else {
      throw new Error(`Could not resolve agent URL for ${agentName} and no AGENT_URL fallback configured`);
    }
  }

  const base = agentUrl.replace(/\/+$/, '');

  // Verify agent card and skill availability
  const cardResp = await fetch(`${base}/.well-known/agent-card.json`).catch(() => null);
  if (!cardResp || !cardResp.ok) throw new Error(`Failed to load agent card from ${base}`);
  const card = await cardResp.json().catch(() => ({}));
  const skills: any[] = Array.isArray(card?.skills) ? card.skills : [];
  const hasSkill = skills.some((s: any) => s?.id === 'agent.feedback.requestAuth' || s?.name === 'agent.feedback.requestAuth');
  if (!hasSkill) throw new Error('Agent does not advertise agent.feedback.requestAuth');
  
  // Call the skill endpoint
  const a2aBase = (card?.endpoint && typeof card.endpoint === 'string') ? String(card.endpoint).replace(/\/+$/, '') : `${base}/a2a`;
  const skillUrl = `${a2aBase}/skills/agent.feedback.requestAuth`;
  console.info(`[MovieClientUI] Calling feedbackAuth skill at: ${skillUrl}`);
  
  // Prepare request body matching the endpoint signature:
  // - clientAddress (required): string - Client's Ethereum address
  // - chainId (required): number - Chain ID
  // - indexLimit (required): bigint/number - Maximum index for feedback auth
  // - expirySeconds (required): number - Expiration time in seconds
  // - agentId (required): string - Agent ID as string (will be converted to BigInt)
  // - taskRef (required): string - Task reference identifier
  if (!agentIdResolved) {
    throw new Error('agentId is required but was not resolved');
  }
  if (!taskRef) {
    throw new Error('taskRef is required but was not provided');
  }
  
  const requestBody: any = {
    clientAddress: clientAddress as `0x${string}`,
    chainId: Number(process.env.ERC8004_CHAIN_ID || 11155111),
    indexLimit: indexLimit,
    expirySeconds: expiry,  // Map expiry to expirySeconds to match function signature
    agentId: agentIdResolved.toString(),  // Required - always include
    taskRef: taskRef,  // Required - always include
  };
  
  // Remove undefined values before sending and logging
  const cleanRequestBody = Object.fromEntries(
    Object.entries(requestBody).filter(([_, v]) => v !== undefined)
  );
  console.info("......... agentIdResolved: ", agentIdResolved?.toString());
  console.info(`[MovieClientUI] Request body for feedbackAuth:`, JSON.stringify(cleanRequestBody));
  
  const resp = await fetch(skillUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cleanRequestBody)  // Use cleaned request body without undefined values
  });
  
  if (!resp.ok) {
    const errorText = await resp.text().catch(() => '');
    throw new Error(`Agent responded with ${resp.status}: ${errorText}`);
  }
  
  const data = await resp.json();
  console.info(`[MovieClientUI] Agent response:`, data);
  const feedbackAuthId = data?.feedbackAuthId || data?.signature || data?.feedbackAuth || null;
  if (!feedbackAuthId) {
    console.error(`[MovieClientUI] No feedbackAuth in response:`, data);
    throw new Error('No feedbackAuth returned by agent');
  }
  return feedbackAuthId as string;
}

// Resolve agentId from agentName using discoverAgents and buildAgentDetail
async function resolveAgentIdByName(agentName: string): Promise<bigint | null> {
  try {
    // Remove '.8004-agent.eth' suffix from agent name before searching
    const searchAgentName = agentName.replace(/\.8004-agent\.eth$/, '');
    
    // Use discoverAgents to search for agent by name (matching the working example pattern)
    const discoverResult = await discoverAgents({
      params: {
        agentName: searchAgentName
      }
    } as any, getAgenticTrustClient);

    // Find the matching agent from discovery results (match both original and stripped name)
    const discoveredAgent = discoverResult.agents?.find((agent: any) =>
      agent.agentName === agentName || agent.name === agentName ||
      agent.agentName === searchAgentName || agent.name === searchAgentName
    );

    if (!discoveredAgent) {
      console.warn(`[MovieClientUI] Agent not found in discovery for ID resolution: ${agentName}`);
      return null;
    }

    const discoveredAgentId = discoveredAgent.agentId;
    if (!discoveredAgentId) {
      console.warn(`[MovieClientUI] Agent ID not found in discovery result for ID resolution: ${agentName}`);
      return null;
    }

    const client = await getAgenticTrustClient();
    const agentDetail = await buildAgentDetail(client, discoveredAgentId);
    return agentDetail.agentId ? BigInt(agentDetail.agentId) : null;
  } catch (error: any) {
    console.warn(`[MovieClientUI] Failed to resolve agent ID for ${agentName}: ${error.message}`);
    return null;
  }
}

// Get client address derived from CLIENT_WALLET_EOA_PRIVATE_KEY in env
app.get('/api/config/client-address', (req, res) => {
  try {
    const clientPrivateKey = (process.env.CLIENT_WALLET_EOA_PRIVATE_KEY || '').trim() as `0x${string}`;
    if (!clientPrivateKey || !clientPrivateKey.startsWith('0x') || clientPrivateKey.length !== 66) {
      return res.json({ clientAddress: '' });
    }
    const account = privateKeyToAccount(clientPrivateKey);
    return res.json({ clientAddress: account.address });
  } catch (error: any) {
    console.error('[MovieClientUI] Error deriving client address:', error?.message || error);
    return res.json({ clientAddress: '' });
  }
});

// Get feedback auth (GET) - accepts query params: clientAddress, agentName, taskRef
app.get('/api/feedback-auth', async (req, res) => {
  try {
    const clientAddress = String(req.query.clientAddress || '').trim();
    const agentName = String(req.query.agentName || '').trim();
    const taskRef = String(req.query.taskRef || '').trim();
    if (!clientAddress || !clientAddress.startsWith('0x') || clientAddress.length !== 42) {
      return res.status(400).json({ error: 'clientAddress must be a 0x-prefixed 20-byte address' });
    }
    if (!agentName) {
      return res.status(400).json({ error: 'agentName is required' });
    }
    if (!taskRef) {
      return res.status(400).json({ error: 'taskRef is required' });
    }
    const feedbackAuthId = await resolveFeedbackAuth({ clientAddress, agentName, taskRef, indexLimit: 1, expirySec: Number(process.env.ERC8004_FEEDBACKAUTH_TTL_SEC || 3600) });
    res.json({ feedbackAuthId });
  } catch (error: any) {
    console.error('[MovieClientUI] Error getting feedback auth ID:', error?.message || error);
    res.status(500).json({ error: error?.message || 'Internal server error' });
  }
});

// Get all feedback
app.get('/api/feedback', async (req, res) => {
  try {
    console.info("[MovieClientUI] Read all feedback from reputation client: req.query", req.query.agentName);
    const agentName = String(req.query.agentName || '').trim();
    if (!agentName) {
      return res.json([]);
    }

    // Resolve agentId
    const agentId = await resolveAgentIdByName(agentName);
    if (!agentId || agentId === 0n) return res.json([]);

    // GraphQL-driven feedback fetch
    const GRAPHQL_URL = String(process.env.REPUTATION_GRAPHQL_URL || process.env.GRAPHQL_URL || '').trim();
    if (!GRAPHQL_URL) {
      console.warn('GRAPHQL_URL not configured; returning empty feedback list');
      return res.json([]);
    }

    const query = `query Feedbacks($first: Int!, $agentId: String!) {
      repFeedbacks(first: $first, orderBy: timestamp, orderDirection: desc, where: { agentId: $agentId }) {
        id
        agentId
        clientAddress
        score
        tag1
        tag2
        feedbackUri
        feedbackHash
        txHash
        blockNumber
        timestamp
      }
    }`;

    const fetchJson = async (body: any) => {
      const endpoint = GRAPHQL_URL.replace(/\/graphql\/?$/i, '');
      const resp = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'accept': 'application/json' }, body: JSON.stringify(body) } as any);
      if (!resp.ok) {
        let text = '';
        try { text = await resp.text(); } catch {}
        throw new Error(`GraphQL ${resp.status}: ${text || resp.statusText}`);
      }
      return await resp.json();
    };

    const first = Number(process.env.FEEDBACK_QUERY_LIMIT || 50);
    const respGql = await fetchJson({ query, variables: { first, agentId: agentId.toString() } });
    const rows: any[] = respGql?.data?.repFeedbacks || [];

    const enrichedList = await Promise.all(rows.map(async (row: any, i: number) => {
      const score = Number(row?.score ?? 0);
      const feedbackUriRaw = String(row?.feedbackUri || '').trim();
      let notes = '';
      if (feedbackUriRaw) {
        try {
          const m = feedbackUriRaw.match(/(?:ipfs:\/\/|\/ipfs\/)([^/?#]+)/);
          const cid = m ? m[1] : feedbackUriRaw;
          const json = await IpfsService.downloadJson(cid);
          const obj = (json as any) || {};
          notes = String(obj?.comment || obj?.comments || obj?.note || '');
        } catch {}
      }
      return {
        id: i + 1,
        domain: agentName,
        rating: score,
        notes,
        createdAt: new Date().toISOString(),
        feedbackAuthId: '',
      };
    }));

    res.json(enrichedList);
  } catch (error: any) {
    console.error('[MovieClientUI] Error getting on-chain feedback:', error?.message || error);
    res.status(500).json({ error: error?.message || 'Internal server error' });
  }
});

// Add feedback
app.post('/api/feedback', async (req, res) => {
  try {
    const { rating, comment, agentId, domain, taskId, contextId, isReserve, proofOfPayment, agentName, feedbackAuthId: feedbackAuthFromClient } = req.body;
    
    if (!rating || !comment) {
      return res.status(400).json({ error: 'Rating and comment are required' });
    }
    
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }
    
    // Resolve feedbackAuth if client provided agentName but no feedbackAuth
    let finalFeedbackAuthId = feedbackAuthFromClient || '';
    if (!finalFeedbackAuthId && agentName) {
      const clientPrivateKey = (process.env.CLIENT_WALLET_EOA_PRIVATE_KEY || '').trim() as `0x${string}`;
      if (!clientPrivateKey || !clientPrivateKey.startsWith('0x')) {
        throw new Error('CLIENT_WALLET_EOA_PRIVATE_KEY not set or invalid. Please set a 0x-prefixed 32-byte hex in .env');
      }
      const clientAccount = privateKeyToAccount(clientPrivateKey);
      // taskRef is required - use taskId if provided, otherwise generate a default
      const taskRefForAuth = taskId || contextId || `task-${Date.now()}`;
      finalFeedbackAuthId = await resolveFeedbackAuth({ clientAddress: clientAccount.address, agentName, taskRef: taskRefForAuth });
    }

    console.info("[MovieClientUI] Add feedback for agentName", agentName);
    console.info("[MovieClientUI] Add feedback for finalFeedbackAuthId", finalFeedbackAuthId);

    // Compute final agentId/domain if not provided
    let finalAgentId: bigint | undefined = undefined;
    if (agentId) {
      try { finalAgentId = BigInt(agentId); } catch {}
    } else if (agentName) {
      const resolvedId = await resolveAgentIdByName(agentName);
      if (resolvedId && resolvedId > 0n) finalAgentId = resolvedId;
    }
    const finalDomain = domain || agentName || undefined;

    const result = await addFeedback({
      rating: parseInt(rating),
      comment,
      ...(finalAgentId !== undefined && { agentId: finalAgentId }),
      ...(finalDomain && { domain: finalDomain }),
      ...(taskId && { taskId }),
      ...(contextId && { contextId }),
      ...(isReserve !== undefined && { isReserve }),
      ...(proofOfPayment && { proofOfPayment }),
      ...(finalFeedbackAuthId && { feedbackAuthId: finalFeedbackAuthId })
    });
    
    res.json(result);
  } catch (error: any) {
    console.error('[MovieClientUI] Error adding feedback:', error?.message || error);
    res.status(500).json({ error: error?.message || 'Internal server error' });
  }
});

// Accept feedback via delegation (GET)
app.get('/api/feedback/accept', async (req, res) => {
  try {
    const agentName = String(req.query.agentName || '').trim();
    const feedbackAuth = String(req.query.feedbackAuth || '').trim() as `0x${string}`;
    if (!agentName) {
      return res.status(400).json({ error: 'agentName is required' });
    }
    if (!feedbackAuth || !feedbackAuth.startsWith('0x')) {
      return res.status(400).json({ error: 'feedbackAuth is required' });
    }

    const clientPrivateKey = (process.env.CLIENT_WALLET_EOA_PRIVATE_KEY || '').trim() as `0x${string}`;
    if (!clientPrivateKey || !clientPrivateKey.startsWith('0x')) {
      throw new Error('CLIENT_WALLET_EOA_PRIVATE_KEY not set or invalid. Please set a 0x-prefixed 32-byte hex in .env');
    }
    const clientAccount = privateKeyToAccount(clientPrivateKey);

    console.info("[MovieClientUI] Accept feedback - clientAccount", clientAccount.address); 
    console.info("[MovieClientUI] Accept feedback - agentName", agentName);
    console.info("[MovieClientUI] Accept feedback - feedbackAuth", feedbackAuth);
    const result = await acceptFeedbackWithDelegation({
      clientAccount,
      agentName,
      feedbackAuth: feedbackAuth as `0x${string}`
    });
    
    res.json({ result });
  } catch (error: any) {
    console.error('[MovieClientUI] Error accepting feedback:', error?.message || error);
    res.status(500).json({ error: error?.message || 'Internal server error' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'movie-client-ui-backend' });
});

// Start the server
app.listen(PORT, HOST, () => {
  console.log(`[MovieClientUI Backend] Server started on http://${HOST}:${PORT}`);
  console.log(`[MovieClientUI Backend] API endpoints available at http://${HOST}:${PORT}/api`);
});

