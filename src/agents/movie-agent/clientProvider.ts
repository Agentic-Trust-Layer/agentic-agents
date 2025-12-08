import type { PublicClient, WalletClient, Account } from 'viem';
import { ViemAccountProvider } from '@agentic-trust/8004-ext-sdk';
import { AIAgentReputationClient, AIAgentIdentityClient } from '@agentic-trust/8004-ext-sdk';


let reputationClient: AIAgentReputationClient | null = null;
let identityClient: AIAgentIdentityClient | null = null;


export async function initReputationClient(params: {
  publicClient: PublicClient;
  walletClient?: WalletClient;
  agentAccount?: Account;
  clientAccount?: Account;
  reputationRegistry: `0x${string}`;
  ensRegistry: `0x${string}`;
}) {
  const { publicClient, walletClient, clientAccount, agentAccount, reputationRegistry, ensRegistry } = params;
  const clientAdapter = new ViemAccountProvider(publicClient as any, walletClient as any, clientAccount as any);
  const agentAdapter = new ViemAccountProvider(publicClient as any, walletClient as any, agentAccount as any);
  reputationClient = await AIAgentReputationClient.create(
    agentAdapter as any,
    clientAdapter as any,
    reputationRegistry,
    ensRegistry,
  );
}

export function getReputationClient(): AIAgentReputationClient {
  if (!reputationClient) throw new Error('AIAgentReputation not initialized');
  return reputationClient;
}


export function initIdentityClient(params: {
  publicClient: PublicClient;
  walletClient?: WalletClient;
  agentAccount?: Account;
  identityRegistry: `0x${string}`;
  ensRegistry: `0x${string}`;
}) {
  const { publicClient, walletClient, agentAccount, identityRegistry, ensRegistry } = params;
  const agentAdapter = new ViemAccountProvider(publicClient as any, walletClient as any, agentAccount as any);
  const orgAdapter = new ViemAccountProvider(publicClient as any, walletClient as any, undefined as any);
  identityClient = new AIAgentIdentityClient(
    agentAdapter as any,
    orgAdapter as any,
    identityRegistry,
    ensRegistry,
  );
}

export function getIdentityClient(): AIAgentIdentityClient {
  if (!identityClient) throw new Error('AIAgentIdentity not initialized');
  return identityClient;
}

