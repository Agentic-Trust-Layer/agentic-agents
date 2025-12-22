type RuntimeEnv = Record<string, string | undefined>;

type Hex = `0x${string}`;

type SessionPackage = {
  agentId: number;
  chainId: number;
  aa: Hex; // smart account (delegator)
  sessionAA?: Hex; // delegate smart account (optional)
  reputationRegistry: Hex;
  selector: Hex;
  sessionKey: {
    privateKey: Hex;
    address: Hex;
    validAfter: number;
    validUntil: number;
  };
  entryPoint: Hex;
  bundlerUrl: string;
  delegationRedeemData?: Hex; // optional pre-encoded redeemDelegations call data
  signedDelegation: {
    message: {
      delegate: Hex;
      delegator: Hex;
      authority: Hex;
      caveats: any[];
      salt: Hex;
      signature: Hex;
    };
    signature: Hex;
  };
};

function getRuntimeEnvValue(key: string): string | undefined {
  const runtimeEnv = (globalThis as any)?.MOVIE_AGENT_ENV as RuntimeEnv | undefined;
  const v = runtimeEnv?.[key] ?? (typeof process !== 'undefined' ? (process.env as any)?.[key] : undefined);
  return typeof v === 'string' ? v : undefined;
}

function requireRuntimeEnvValue(key: string): string {
  const v = (getRuntimeEnvValue(key) || '').trim();
  if (!v) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return v;
}

function decodeBase64ToString(b64: string): string {
  // Prefer atob if present (Workers); fall back to Buffer (Node).
  if (typeof (globalThis as any).atob === 'function') {
    return (globalThis as any).atob(b64);
  }
  // eslint-disable-next-line no-undef
  return Buffer.from(b64, 'base64').toString('utf-8');
}

function parseSessionPackageJson(raw: string): any {
  const trimmed = (raw || '').trim();
  try {
    return JSON.parse(trimmed);
  } catch (e1: any) {
    // Support base64-encoded JSON to avoid quoting/escaping hassles in secrets tooling.
    // Accepted formats:
    // - "base64:<...>"
    // - "<...>" (if it parses as base64 -> JSON)
    const b64 = trimmed.startsWith('base64:') ? trimmed.slice('base64:'.length).trim() : trimmed;
    try {
      const decoded = decodeBase64ToString(b64);
      return JSON.parse(decoded);
    } catch (e2: any) {
      throw new Error(
        `Invalid AGENTIC_TRUST_SESSION_PACKAGE_JSON: ${e1?.message || e1}. ` +
          `Also tried base64 decoding but failed: ${e2?.message || e2}`,
      );
    }
  }
}

export function loadSessionPackage(): any {
  const raw = requireRuntimeEnvValue('AGENTIC_TRUST_SESSION_PACKAGE_JSON');
  return parseSessionPackageJson(raw);
}

export function validateSessionPackage(pkg: SessionPackage): void {
  if (!pkg.chainId) throw new Error('sessionPackage.chainId is required');
  if (!pkg.aa) throw new Error('sessionPackage.aa is required');
  if (!pkg.entryPoint) throw new Error('sessionPackage.entryPoint is required');
  if (!pkg.bundlerUrl) throw new Error('sessionPackage.bundlerUrl is required');
  if (!pkg.sessionKey?.privateKey || !pkg.sessionKey?.address) {
    throw new Error('sessionPackage.sessionKey.privateKey and address are required');
  }
  if (!pkg.signedDelegation?.signature) {
    throw new Error('sessionPackage.signedDelegation.signature is required');
  }
}
