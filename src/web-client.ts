#!/usr/bin/env node

import "dotenv/config";
import express from "express";
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { acceptFeedbackWithDelegation, addFeedback } from "./agents/movie-agent/agentAdapter.js";
import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, http } from 'viem';
import { reputationRegistryAbi } from "./lib/abi/reputationRegistry.js";
import { initIdentityClient, getIdentityClient, initReputationClient, getReputationClient } from './agents/movie-agent/clientProvider.js';
import IpfsService from './services/ipfs.js';
import type { PaymentQuote, PaymentIntent, AgentCallEnvelope, PaymentReceipt } from './shared/ap2.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.WEB_CLIENT_PORT) || 3001;
const HOST = process.env.HOST || 'localhost';

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
async function resolveFeedbackAuth(params: { clientAddress: string; agentName: string; indexLimit?: number; expirySec?: number }): Promise<string> {
  const { clientAddress, agentName } = params;
  const indexLimit = params.indexLimit ?? 1;
  const expiry = params.expirySec ?? Number(process.env.ERC8004_FEEDBACKAUTH_TTL_SEC || 3600);

  const rpcUrl = (process.env.RPC_URL || process.env.JSON_RPC_URL || 'https://rpc.sepolia.org');
  const pub = createPublicClient({ chain: undefined as any, transport: http(rpcUrl) });
  const repReg = (process.env.AGENTIC_TRUST_REPUTATION_REGISTRY_SEPOLIA || '').trim();
  if (!repReg) throw new Error('AGENTIC_TRUST_REPUTATION_REGISTRY_SEPOLIA is required to resolve identity registry');
  const identityReg = await pub.readContract({ address: repReg as any, abi: reputationRegistryAbi as any, functionName: 'getIdentityRegistry', args: [] }) as `0x${string}`;
  const ensRegistry = (process.env.ENS_REGISTRY || process.env.NEXT_PUBLIC_ENS_REGISTRY || '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e') as `0x${string}`;
  initIdentityClient({ publicClient: pub as any, identityRegistry: identityReg as any, ensRegistry } as any);
  const identity = getIdentityClient();
  const agentUrl = await identity.getAgentUrlByName(agentName);
  if (!agentUrl) throw new Error(`Could not resolve agent URL for ${agentName}`);
  const idInfo = await identity.getAgentIdentityByName(agentName);
  const agentIdResolved = idInfo?.agentId;
  const base = agentUrl.replace(/\/+$/, '');
  const cardResp = await fetch(`${base}/.well-known/agent.json`).catch(() => null);
  if (!cardResp || !cardResp.ok) throw new Error('Failed to load agent card');
  const card = await cardResp.json().catch(() => ({}));
  const skills: any[] = Array.isArray(card?.skills) ? card.skills : [];
  const hasSkill = skills.some((s: any) => s?.id === 'agent.feedback.requestAuth' || s?.name === 'agent.feedback.requestAuth');
  if (!hasSkill) throw new Error('Agent does not advertise agent.feedback.requestAuth');
  const a2aBase = (card?.endpoint && typeof card.endpoint === 'string') ? String(card.endpoint).replace(/\/+$/, '') : `${base}/a2a`;
  
  
  console.info("........... a2aBase ........: ", a2aBase);
  const skillUrl = `${a2aBase}/skills/agent.feedback.requestAuth`;
  const resp = await fetch(skillUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientAddress, ...(agentIdResolved ? { agentId: agentIdResolved.toString() } : {}), chainId: Number(process.env.ERC8004_CHAIN_ID || 11155111), indexLimit, expiry })
  });
  if (!resp.ok) throw new Error(`Movie agent responded with ${resp.status}`);
  const data = await resp.json();
  const feedbackAuthId = data?.feedbackAuthId || data?.signature || data?.feedbackAuth || null;
  if (!feedbackAuthId) throw new Error('No feedbackAuth returned by agent');
  return feedbackAuthId as string;
}

// Resolve agentId from agentName (ENS) via identity registry
async function resolveAgentIdByName(agentName: string): Promise<bigint | null> {
  const rpcUrl = (process.env.RPC_URL || process.env.JSON_RPC_URL || 'https://rpc.sepolia.org');
  const pub = createPublicClient({ chain: undefined as any, transport: http(rpcUrl) });
  const repReg = (process.env.AGENTIC_TRUST_REPUTATION_REGISTRY_SEPOLIA || '').trim();
  if (!repReg) throw new Error('AGENTIC_TRUST_REPUTATION_REGISTRY_SEPOLIA is required to resolve identity registry');
  const identityReg = await pub.readContract({ address: repReg as any, abi: reputationRegistryAbi as any, functionName: 'getIdentityRegistry', args: [] }) as `0x${string}`;
  const ensRegistry = (process.env.ENS_REGISTRY || process.env.NEXT_PUBLIC_ENS_REGISTRY || '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e') as `0x${string}`;
  initIdentityClient({ publicClient: pub as any, identityRegistry: identityReg as any, ensRegistry } as any);
  const identity = getIdentityClient();
  const info = await identity.getAgentIdentityByName(agentName);
  return info?.agentId ?? null;
}

// Serve the main HTML page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});



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
    console.error('[WebClient] Error deriving client address:', error?.message || error);
    return res.json({ clientAddress: '' });
  }
});

// Agent endpoint (preferred)
app.get('/.well-known/agent.json', (req, res) => {
  try {
    const agentCardPath = path.join(__dirname, 'web-client-agent-card.json');
    const agentCard = JSON.parse(fs.readFileSync(agentCardPath, 'utf8'));
    res.json(agentCard);
  } catch (error) {
    console.error('Error serving agent card:', error);
    res.status(500).json({ error: 'Failed to load agent card' });
  }
});

// Back-compat alias
app.get('/.well-known/agent-card.json', (req, res) => {
  res.redirect(302, '/.well-known/agent.json');
});

// Feedback endpoint
app.get('/.well-known/feedback.json', (req, res) => {
  try {
    // Deprecated: local feedback storage removed. Expose empty list or migrate to on-chain source.
    res.json([]);
  } catch (error: any) {
    console.error('[WebClient] Error serving feedback.json:', error?.message || error);
    res.json([]);
  }
});

// API endpoints for the web interface

// Get feedback statistics
app.get('/api/feedback/stats', (req, res) => {
  try {
    // Deprecated: local stats removed. Client should compute from /api/feedback response
    res.json({ total: 0, averageRating: 0, byDomain: {}, byRating: {} });
  } catch (error: any) {
    console.error('[WebClient] Error getting feedback stats:', error?.message || error);
    res.status(500).json({ error: error?.message || 'Internal server error' });
  }
});

// Get all feedback
app.get('/api/feedback', async (req, res) => {
  try {
    console.info(" read all feedback from reputation client: req.query", req.query.agentName);
    const agentName = String(req.query.agentName || '').trim();
    if (!agentName) {
      // No agent specified; return empty (migrated off local storage)
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

    const query = `query Feedbacks($first: Int!, $agentId: String!) {\n      repFeedbacks(first: $first, orderBy: timestamp, orderDirection: desc, where: { agentId: $agentId }) {\n        id\n        agentId\n        clientAddress\n        score\n        tag1\n        tag2\n        feedbackUri\n        feedbackHash\n        txHash\n        blockNumber\n        timestamp\n      }\n    }`;

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
    console.error('[WebClient] Error getting on-chain feedback:', error?.message || error);
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
      finalFeedbackAuthId = await resolveFeedbackAuth({ clientAddress: clientAccount.address, agentName });
    }

    console.info("----------> add feedback for agentName", agentName);
    console.info("----------> add feedback for finalFeedbackAuthId", finalFeedbackAuthId);

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
    console.error('[WebClient] Error adding feedback:', error?.message || error);
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

    console.info("*************** clientAccount", clientAccount); 
    console.info("*************** agentName", agentName);
    console.info("*************** feedbackAuth", feedbackAuth);
    const result = await acceptFeedbackWithDelegation({
      clientAccount,
      agentName,
      feedbackAuth: feedbackAuth as `0x${string}`
    });
    
    res.json({ result });
  } catch (error: any) {
    console.error('[WebClient] Error accepting feedback:', error?.message || error);
    res.status(500).json({ error: error?.message || 'Internal server error' });
  }
});

// Get feedback auth (GET) - accepts query params: clientAddress, agentName
app.get('/api/feedback-auth', async (req, res) => {
  try {
    const clientAddress = String(req.query.clientAddress || '').trim();
    const agentName = String(req.query.agentName || '').trim();
    if (!clientAddress || !clientAddress.startsWith('0x') || clientAddress.length !== 42) {
      return res.status(400).json({ error: 'clientAddress must be a 0x-prefixed 20-byte address' });
    }
    if (!agentName) {
      return res.status(400).json({ error: 'agentName is required' });
    }
    const feedbackAuthId = await resolveFeedbackAuth({ clientAddress, agentName, indexLimit: 1, expirySec: Number(process.env.ERC8004_FEEDBACKAUTH_TTL_SEC || 3600) });
    res.json({ feedbackAuthId });
  } catch (error: any) {
    console.error('[WebClient] Error getting feedback auth ID:', error?.message || error);
    res.status(500).json({ error: error?.message || 'Internal server error' });
  }
});

// Test movie agent connection
app.get('/api/movie-agent/status', async (req, res) => {
  try {
    const movieAgentUrl = process.env.MOVIE_AGENT_URL || 'https://30391b39.movie-agent.pages.dev';
    const response = await fetch(`${movieAgentUrl}/.well-known/agent.json`);
    
    if (response.ok) {
      const agentCard = await response.json();
      res.json({ 
        status: 'connected', 
        agentCard,
        url: movieAgentUrl 
      });
    } else {
      res.json({ 
        status: 'disconnected', 
        error: `HTTP ${response.status}`,
        url: movieAgentUrl 
      });
    }
  } catch (error: any) {
    console.error('[WebClient] Error checking movie agent status:', error?.message || error);
    res.json({ 
      status: 'disconnected', 
      error: error?.message || 'Connection failed',
      url: process.env.MOVIE_AGENT_URL || 'https://30391b39.movie-agent.pages.dev'
    });
  }
});

// AP2: proxy to request a quote from movie-agent (server agent)
app.post('/api/ap2/quote', async (req, res) => {
  try {
    const agentBase = process.env.MOVIE_AGENT_URL || 'https://30391b39.movie-agent.pages.dev';
    const response = await fetch(`${agentBase}/ap2/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capability: req.body?.capability || 'summarize:v1' }),
    } as any);
    const data = await response.json();
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'quote failed' });
  }
});

// AP2: proxy to invoke with a signed intent
app.post('/api/ap2/invoke', async (req, res) => {
  try {
    const payload: AgentCallEnvelope = req.body as any;
    const agentBase = process.env.MOVIE_AGENT_URL || 'https://30391b39.movie-agent.pages.dev';
    const response = await fetch(`${agentBase}/ap2/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    } as any);
    const data = await response.json();
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'invoke failed' });
  }
});

// Get on-chain reputation summary for an agent by name
app.get('/api/reputation/summary', async (req, res) => {
  try {
    const agentName = String(req.query.agentName || '').trim();
    if (!agentName) return res.status(400).json({ error: 'agentName is required' });

    // Resolve agentId
    const agentId = await resolveAgentIdByName(agentName);
    if (!agentId || agentId === 0n) return res.status(404).json({ error: 'Agent not found' });

    // Build public client and init reputation SDK
    const rpcUrl = (process.env.RPC_URL || process.env.JSON_RPC_URL || 'https://rpc.sepolia.org');
    const pub = createPublicClient({ chain: undefined as any, transport: http(rpcUrl) });
    const repReg = (process.env.AGENTIC_TRUST_REPUTATION_REGISTRY_SEPOLIA || '').trim();
    if (!repReg) return res.status(500).json({ error: 'AGENTIC_TRUST_REPUTATION_REGISTRY_SEPOLIA is not configured' });
    await initReputationClient({ publicClient: pub as any, reputationRegistry: repReg as `0x${string}`, ensRegistry: (process.env.ENS_REGISTRY || process.env.NEXT_PUBLIC_ENS_REGISTRY || '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e') as any } as any);
    const rep = getReputationClient() as any;
    const summary = await rep.getSummary(agentId);
    const count = BigInt(summary?.count ?? 0n);
    const averageScore = Number(summary?.averageScore ?? 0);
    res.json({ agentId: agentId.toString(), count: count.toString(), averageScore });
  } catch (error: any) {
    console.error('[WebClient] Error getting reputation summary:', error?.message || error);
    res.status(500).json({ error: error?.message || 'Internal server error' });
  }
});

// Start the server
app.listen(PORT, HOST, () => {
  console.log(`[WebClient] Server started on http://${HOST}:${PORT}`);
  console.log(`[WebClient] Feedback Endpoint: http://${HOST}:${PORT}/.well-known/feedback.json`);
  console.log(`[WebClient] Web Interface: http://${HOST}:${PORT}`);
  console.log(`[WebClient] API Documentation: http://${HOST}:${PORT}/api`);
});
