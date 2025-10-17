import type { PublicClient, WalletClient, Account } from 'viem';
import { ViemAdapter } from '../../erc8004-src/adapters/viem.js';
import { AIAgentReputationClient } from '../../erc8004-agentic-trust-sdk/AIAgentReputationClient.js';

let reputationClient: AIAgentReputationClient | null = null;


export function initReputationClient(params: {
  publicClient: PublicClient;
  walletClient?: WalletClient;
  agentAccount?: Account;
  clientAccount?: Account;
  reputationRegistry: `0x${string}`;
  identityRegistry: `0x${string}`;
  ensRegistry: `0x${string}`;
}) {
  const { publicClient, walletClient, clientAccount, agentAccount, reputationRegistry, identityRegistry, ensRegistry } = params;
  const clientAdapter = new ViemAdapter(publicClient as any, walletClient as any, clientAccount as any);
  const agentAdapter = new ViemAdapter(publicClient as any, walletClient as any, agentAccount as any);
  reputationClient = new AIAgentReputationClient(
    agentAdapter as any, 
    clientAdapter as any, 
    reputationRegistry, 
    identityRegistry,
    ensRegistry);
}

export function getReputationClient(): AIAgentReputationClient {
  if (!reputationClient) throw new Error('AIAgentReputation not initialized');
  return reputationClient;
}


