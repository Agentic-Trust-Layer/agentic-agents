export type ChainIdHex = `0x${string}`;

export interface PaymentQuote {
  quoteId: string;
  agent: string;
  capability: string;
  unit: 'call' | 'second' | 'token';
  rate: string;
  token: string;
  chainId: ChainIdHex;
  expiresAt: number;
  termsCid?: string;
  agentSig?: string;
}

export interface PaymentIntent {
  quoteId: string;
  payer: string;
  mode: 'direct'|'sponsored'|'escrow'|'stream';
  maxSpend: string;
  nonce: string;
  deadline: number;
  signature: string;
}

export interface PaymentReceipt {
  requestHash: string;
  meteredUnits: number;
  amount: string;
  token: string;
  chainId: ChainIdHex;
  settlementRef?: string;
  agentSig: string;
}

export interface AgentCallEnvelope {
  protocol: 'A2A'|'MCP';
  capability: string;
  payload: any;
  payment: { intent: PaymentIntent };
  auth: { caller: string; proofType: 'eip191'; proof: string };
}


