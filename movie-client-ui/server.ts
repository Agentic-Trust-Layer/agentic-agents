#!/usr/bin/env node

import "dotenv/config";
import express from "express";
import { fileURLToPath } from 'url';
import path from 'path';
import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, http } from 'viem';
import { reputationRegistryAbi } from "../src/lib/abi/reputationRegistry.js";
import { discoverAgents, getAgenticTrustClient, getClientApp, type DiscoverRequest } from '@agentic-trust/core/server';
import IpfsService from '../src/services/ipfs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.BACKEND_PORT) || 3000;
const HOST = process.env.HOST || 'localhost';

// ---- Agentic Trust "ClientApp" bootstrap (server-side signing) ----
// The Agentic Trust server SDK expects:
// - roles enabled via AGENTIC_TRUST_APP_ROLES="client" (or legacy AGENTIC_TRUST_IS_CLIENT_APP=true)
// - signing key in AGENTIC_TRUST_ADMIN_PRIVATE_KEY
// - chain RPC + registries via AGENTIC_TRUST_*_{CHAIN}
//
// movie-client-ui historically used:
// - CLIENT_WALLET_EOA_PRIVATE_KEY
// - RPC_URL
// - AGENTIC_TRUST_REPUTATION_REGISTRY_SEPOLIA / AGENTIC_TRUST_IDENTITY_REGISTRY_SEPOLIA
//
// Bridge these at process start so the SDK initializes correctly.
(() => {
  const chainId = Number(process.env.ERC8004_CHAIN_ID || 11155111);
  if (chainId !== 11155111) {
    // This project currently assumes Sepolia; keep bridging conservative.
    return;
  }

  // Enable ClientApp role (preferred: role list)
  const rolesRaw = (process.env.AGENTIC_TRUST_APP_ROLES || '').trim();
  if (rolesRaw) {
    const roles = rolesRaw.split('|').map((r) => r.trim()).filter(Boolean);
    if (!roles.map((r) => r.toLowerCase()).includes('client')) {
      process.env.AGENTIC_TRUST_APP_ROLES = `${rolesRaw}|client`;
    }
  } else if (!process.env.AGENTIC_TRUST_IS_CLIENT_APP) {
    process.env.AGENTIC_TRUST_APP_ROLES = 'client';
  }

  // Private key: allow using the existing client wallet key to initialize ClientApp.
  const clientPk = (process.env.CLIENT_WALLET_EOA_PRIVATE_KEY || '').trim();
  if (clientPk && !process.env.AGENTIC_TRUST_ADMIN_PRIVATE_KEY) {
    process.env.AGENTIC_TRUST_ADMIN_PRIVATE_KEY = clientPk;
  }

  // RPC URL (Agentic Trust core requires chain-specific env vars)
  const rpcUrl = (process.env.RPC_URL || process.env.JSON_RPC_URL || '').trim();
  if (rpcUrl && !process.env.AGENTIC_TRUST_RPC_URL_SEPOLIA) {
    process.env.AGENTIC_TRUST_RPC_URL_SEPOLIA = rpcUrl;
  }

  // Registries (defaults for Sepolia if not supplied)
  if (!process.env.AGENTIC_TRUST_IDENTITY_REGISTRY_SEPOLIA) {
    process.env.AGENTIC_TRUST_IDENTITY_REGISTRY_SEPOLIA = '0x8004a6090Cd10A7288092483047B097295Fb8847';
  }
  if (!process.env.AGENTIC_TRUST_REPUTATION_REGISTRY_SEPOLIA) {
    process.env.AGENTIC_TRUST_REPUTATION_REGISTRY_SEPOLIA = '0x8004B8FD1A363aa02fDC07635C0c5F94f6Af5B7E';
  }
})();

// Base URL for talking to the movie agent (backend-side).
// Prefer MOVIE_AGENT_URL (new standard), fall back to AGENT_URL for backward compatibility.
const MOVIE_AGENT_URL = (process.env.MOVIE_AGENT_URL || '').trim();

function normalizeAgentBaseUrl(input: string): string {
  const trimmed = String(input || '').trim();
  if (!trimmed) return '';
  try {
    const u = new URL(trimmed);
    // Always use the origin for agent card + A2A calls in this project.
    // (Discovery may return paths like /api, but our agent card is served from origin/.well-known/agent.json)
    return u.origin;
  } catch {
    // Fallback: strip common path suffixes
    return trimmed
      .replace(/\/+$/, '')
      .replace(/\/\.well-known\/agent\.json\/?$/, '')
      .replace(/\/api\/?$/, '');
  }
}

function normalizeDiscoveryAgentKey(input: unknown): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/\.8004-agent\.eth$/i, '')
    .replace(/\.eth$/i, '')
    // drop separators/punctuation to improve matching between "movie-agent" vs "Movie Agent"
    .replace(/[^a-z0-9]/g, '');
}

function pickDiscoveredAgent(result: any, requestedAgentName: string) {
  const agents: any[] = Array.isArray(result?.agents) ? result.agents : [];
  const requestedKey = normalizeDiscoveryAgentKey(requestedAgentName);
  const requestedKeyNoSuffix = normalizeDiscoveryAgentKey(
    String(requestedAgentName || '').replace(/\.8004-agent\.eth$/i, ''),
  );

  const pick = agents.find((agent: any) => {
    const candidates = [
      agent?.agentName,
      agent?.name,
      agent?.ensName,
      agent?.ens,
      agent?.domain,
      agent?.slug,
      agent?.id,
    ];
    return candidates.some((c) => {
      const k = normalizeDiscoveryAgentKey(c);
      return k && (k === requestedKey || k === requestedKeyNoSuffix);
    });
  });
  if (pick) return pick;

  // If discovery returned exactly one agent, trust it even if the name doesn't match exactly.
  if (agents.length === 1) {
    const only = agents[0];
    console.warn(
      `[MovieClientUI] Discovery returned 1 agent but name mismatch: requested="${requestedAgentName}", ` +
        `got agentName="${only?.agentName || ''}" name="${only?.name || ''}" ensName="${only?.ensName || ''}". Using the single result.`,
    );
    return only;
  }

  return null;
}

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

// Helper: resolve feedbackAuth from agent name + client address via identity registry & agent card skill.
// Returns the resolved agent details so callers can keep using the *same agent* afterwards.
async function resolveFeedbackAuth(params: { clientAddress: string; agentName: string; taskRef?: string; indexLimit?: number; expirySec?: number }): Promise<{
  feedbackAuthId: string;
  agentId?: bigint;
  agentUrl?: string;
  canonicalAgentName?: string;
}> {
  const { clientAddress, agentName, taskRef } = params;
  const indexLimit = params.indexLimit ?? 1;
  const expiry = params.expirySec ?? Number(process.env.ERC8004_FEEDBACKAUTH_TTL_SEC || 3600);

  // Fast path (local/dev or explicitly configured): talk to the agent directly.
  // This avoids requiring Agentic Trust discovery credentials just to issue feedback auth.
  if (MOVIE_AGENT_URL) {
    const base = normalizeAgentBaseUrl(MOVIE_AGENT_URL);
    try {
      // STRICT: ensure the frontend is reviewing the same agent that the backend is configured to talk to.
      const cardResp = await fetch(`${base}/.well-known/agent.json`).catch(() => null);
      let cardName = '';
      if (cardResp && cardResp.ok) {
        const card: any = await cardResp.json().catch(() => ({}));
        cardName = String(card?.name || '').trim();
        const requestedName = String(agentName || '').trim();
        if (cardName && requestedName && cardName.toLowerCase() !== requestedName.toLowerCase()) {
          throw new Error(
            `Agent mismatch: frontend requested agentName="${requestedName}" but backend MOVIE_AGENT_URL points to agentName="${cardName}" (${base}). ` +
              `Fix by aligning VITE_MOVIE_AGENT_URL/MOVIE_AGENT_URL with the intended agent.`,
          );
        }
      }

      const resp = await fetch(`${base}/api/feedback-auth/${clientAddress}`);
      if (resp.ok) {
        const data = await resp.json().catch(() => ({}));
        const feedbackAuthId = data?.feedbackAuthId;
        if (feedbackAuthId) {
          console.info(`[MovieClientUI] Using direct agent feedback-auth endpoint at ${base}`);
          return {
            feedbackAuthId: String(feedbackAuthId),
            agentUrl: base,
            canonicalAgentName: cardName || agentName,
          };
        }
      }
    } catch (e: any) {
      console.warn(`[MovieClientUI] Direct feedback-auth endpoint call failed: ${e?.message || e}`);
      // Continue to discovery-based flow below.
    }
  }

  // Always try ENS resolution first (for production/registered agents)
  const rpcUrl = (process.env.RPC_URL || process.env.JSON_RPC_URL || 'https://rpc.sepolia.org');
  const pub = createPublicClient({ chain: undefined as any, transport: http(rpcUrl) });
  const repReg = (process.env.AGENTIC_TRUST_REPUTATION_REGISTRY_SEPOLIA || '').trim();
  if (!repReg) throw new Error('AGENTIC_TRUST_REPUTATION_REGISTRY_SEPOLIA is required to resolve identity registry');

  // Use buildAgentDetail to get all agent information
  // Check if discovery URL is configured
  const discoveryUrl = (process.env.AGENTIC_TRUST_DISCOVERY_URL || '').trim();
  if (!discoveryUrl) {
    // No discovery configured; fall back to direct agent URL if available.
    if (MOVIE_AGENT_URL) {
      throw new Error('AGENTIC_TRUST_DISCOVERY_URL is not set; configure discovery or use the direct agent endpoint (/api/feedback-auth/:clientAddress) which should already have been attempted.');
    }
    throw new Error('AGENTIC_TRUST_DISCOVERY_URL environment variable is required for agent discovery (or set MOVIE_AGENT_URL for direct agent access).');
  }

  // Remove '.8004-agent.eth' suffix from agent name before searching
  const searchAgentName = agentName.replace(/\.8004-agent\.eth$/, '');
  
  let agentDetail;
  let agentUrl: string | undefined;
  let agentIdResolved: bigint | undefined;
  let canonicalAgentName: string | undefined;

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
    const discoveredAgent = pickDiscoveredAgent(result, agentName);
    
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

    // Extract endpoint directly from discovery/search results.
    // `AgentInfo` includes a2aEndpoint/ensEndpoint/agentAccountEndpoint.
    agentUrl = discoveredAgent.a2aEndpoint;
    if (!agentUrl) {
      const ep = await discoveredAgent.getEndpoint().catch(() => null);
      agentUrl = ep?.endpoint;
    }
    if (agentUrl) agentUrl = agentUrl.replace(/\/\.well-known\/agent\.json\/?$/, '');

    canonicalAgentName = String(discoveredAgent?.agentName || discoveredAgent?.name || discoveredAgent?.ensName || agentName).trim();
    console.info(`[MovieClientUI] Agent URL from discovery: ${agentUrl}, Agent ID: ${agentIdResolved}, canonicalName: ${canonicalAgentName}`);
  } catch (error: any) {
    // Log error message only, avoid logging the full error object which might contain circular refs
    const errorMsg = error?.message || String(error);
    console.warn(`[MovieClientUI] discovery lookup failed: ${errorMsg}`);
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
    const directAgentUrl = MOVIE_AGENT_URL;
    if (directAgentUrl) {
      console.info(`[MovieClientUI] Using direct agent URL fallback bbbb: ${directAgentUrl}`);
      agentUrl = directAgentUrl;
    } else {
      throw new Error(`Could not resolve agent URL for ${agentName} and no MOVIE_AGENT_URL/AGENT_URL fallback configured`);
    }
  }

  const base = normalizeAgentBaseUrl(agentUrl);

  // Verify agent card and skill availability
  const cardResp = await fetch(`${base}/.well-known/agent.json`).catch(() => null);
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
  return {
    feedbackAuthId: feedbackAuthId as string,
    agentId: agentIdResolved,
    agentUrl: base,
    canonicalAgentName,
  };
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

    // Pick the best match; if discovery returned exactly 1 agent, we trust it.
    const discoveredAgent = pickDiscoveredAgent(discoverResult, agentName);

    if (!discoveredAgent) {
      console.warn(`[MovieClientUI] Agent not found in discovery for ID resolution: ${agentName}`);
      return null;
    }

    const discoveredAgentId = discoveredAgent.agentId;
    if (!discoveredAgentId) {
      console.warn(`[MovieClientUI] Agent ID not found in discovery result for ID resolution: ${agentName}`);
      return null;
    }

    return discoveredAgentId ? BigInt(discoveredAgentId) : null;
  } catch (error: any) {
    console.warn(`[MovieClientUI] Failed to resolve agent ID for ${agentName}: ${error.message}`);
    return null;
  }
}

// Get client address derived from CLIENT_WALLET_EOA_PRIVATE_KEY in env
app.get('/api/config/client-address', (req, res) => {
  try {
    // Prefer Agentic Trust ClientApp if enabled (keeps address consistent with signing wallet)
    getClientApp()
      .then((clientApp) => {
        const addr = String((clientApp as any)?.address || '').trim();
        if (addr && addr.startsWith('0x') && addr.length === 42) {
          return res.json({ clientAddress: addr });
        }
        const clientPrivateKey = (process.env.CLIENT_WALLET_EOA_PRIVATE_KEY || '').trim() as `0x${string}`;
        if (!clientPrivateKey || !clientPrivateKey.startsWith('0x') || clientPrivateKey.length !== 66) {
          return res.json({ clientAddress: '' });
        }
        const account = privateKeyToAccount(clientPrivateKey);
        return res.json({ clientAddress: account.address });
      })
      .catch(() => res.json({ clientAddress: '' }));
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
    const resolved = await resolveFeedbackAuth({ clientAddress, agentName, taskRef, indexLimit: 1, expirySec: Number(process.env.ERC8004_FEEDBACKAUTH_TTL_SEC || 3600) });
    res.json({
      feedbackAuthId: resolved.feedbackAuthId,
      agentId: resolved.agentId ? resolved.agentId.toString() : '',
      agentUrl: resolved.agentUrl || '',
      canonicalAgentName: resolved.canonicalAgentName || '',
    });
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
    
    // Track the resolved agent for this feedback flow (so we don't rediscover by a different key).
    let finalAgentId: bigint | undefined = undefined;
    let canonicalAgentNameFromAuth: string | undefined = undefined;

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
      const resolved = await resolveFeedbackAuth({ clientAddress: clientAccount.address, agentName, taskRef: taskRefForAuth });
      finalFeedbackAuthId = resolved.feedbackAuthId;
      // Keep using the resolved agent from requestAuth (avoid re-discovery mismatches like "movie-agent")
      canonicalAgentNameFromAuth = resolved.canonicalAgentName || undefined;
      if (!agentId && resolved.agentId) finalAgentId = resolved.agentId;
    }

    console.info("[MovieClientUI] Add feedback for agentName", agentName);
    console.info("[MovieClientUI] Add feedback for finalFeedbackAuthId", finalFeedbackAuthId);

    // Compute final agentId/domain if not provided
    if (agentId) {
      try { finalAgentId = BigInt(agentId); } catch {}
    } else if (!finalAgentId && agentName) {
      const resolvedId = await resolveAgentIdByName(agentName);
      if (resolvedId && resolvedId > 0n) finalAgentId = resolvedId;
    }
    const finalDomain = domain || canonicalAgentNameFromAuth || agentName || undefined;

    // ---- On-chain submission via Agentic Trust core (ClientApp / reputation singleton) ----
    if (!finalFeedbackAuthId) {
      throw new Error('Missing feedbackAuthId (feedbackAuth) for on-chain submission');
    }
    if (!finalAgentId || finalAgentId <= 0n) {
      throw new Error('Missing agentId for on-chain submission');
    }

    const chainId = Number(process.env.ERC8004_CHAIN_ID || 11155111);

    // Ensure we have a ClientApp signer (initialized from env via the bootstrap above)
    const clientApp = await getClientApp();
    const clientAddress = String((clientApp as any)?.address || '').trim();
    if (!clientAddress || !clientAddress.startsWith('0x') || clientAddress.length !== 42) {
      throw new Error(
        'ClientApp is not initialized. Set CLIENT_WALLET_EOA_PRIVATE_KEY and AGENTIC_TRUST_RPC_URL_SEPOLIA, ' +
          'and enable ClientApp via AGENTIC_TRUST_APP_ROLES=client (or AGENTIC_TRUST_IS_CLIENT_APP=true).',
      );
    }

    // Get server-side AgenticTrust client and agent instance
    const atClient = await getAgenticTrustClient();
    const agent = await (atClient as any)?.agents?.getAgent?.(finalAgentId.toString(), chainId);
    if (!agent) {
      throw new Error(`Agent not found for agentId=${finalAgentId.toString()}`);
    }

    const ratingNum = typeof rating === 'number' ? rating : parseInt(String(rating), 10);
    const scorePct = Math.max(0, Math.min(100, ratingNum * 20));

    const feedbackResult = await agent.giveFeedback({
      clientAddress,
      score: scorePct,
      feedback: comment,
      feedbackAuth: finalFeedbackAuthId,
    });

    res.json({
      status: 'ok',
      agentId: finalAgentId.toString(),
      domain: finalDomain || '',
      rating: ratingNum,
      comment,
      proofOfPayment: (feedbackResult?.txHash as string) || '',
    });
  } catch (error: any) {
    console.error('[MovieClientUI] Error adding feedback:', error?.message || error);
    res.status(500).json({ error: error?.message || 'Internal server error' });
  }
});

// Accept feedback via delegation (GET)
// NOTE: The legacy delegation-accept endpoint was removed in favor of the unified
// server-side `agent.giveFeedback()` flow above (ClientApp signer + reputation singleton).

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'movie-client-ui-backend' });
});

// Start the server
app.listen(PORT, HOST, () => {
  console.log(`[MovieClientUI Backend] Server started on http://${HOST}:${PORT}`);
  console.log(`[MovieClientUI Backend] API endpoints available at http://${HOST}:${PORT}/api`);
});

