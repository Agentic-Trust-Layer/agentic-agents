type JsonRecord = Record<string, unknown> | unknown[] | null;

function getPinataApiBase(): string {
  return (process.env.PINATA_API_BASE as string) || 'https://api.pinata.cloud';
}

function getGatewayBase(): string {
  // Example: https://gateway.pinata.cloud/ipfs
  const base = (process.env.PINATA_GATEWAY_BASE as string) || 'https://gateway.pinata.cloud/ipfs';
  return base.replace(/\/$/, '');
}

function buildPinataHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const jwt = (process.env.PINATA_JWT as string | undefined)?.trim();
  const key = (process.env.PINATA_API_KEY as string | undefined)?.trim();
  const secret = (process.env.PINATA_API_SECRET as string | undefined)?.trim();
  if (jwt) {
    headers.Authorization = `Bearer ${jwt}`;
  } else if (key && secret) {
    headers['pinata_api_key'] = key;
    headers['pinata_secret_api_key'] = secret;
  } else {
    throw new Error('Pinata credentials missing. Set PINATA_JWT or PINATA_API_KEY/PINATA_API_SECRET');
  }
  return headers;
}

class IpfsService {
  static get apiBase(): string {
    return getPinataApiBase();
  }

  // Upload JSON via Pinata pinJSONToIPFS
  static async uploadJson(params: { data: JsonRecord; filename?: string }): Promise<{ cid: string; url: string }> {
    const apiBase = getPinataApiBase();
    const url = `${apiBase.replace(/\/$/, '')}/pinning/pinJSONToIPFS`;
    const body = {
      pinataOptions: { cidVersion: 1 },
      pinataMetadata: { name: params.filename || 'data.json' },
      pinataContent: params.data ?? {},
    };
    const res = await fetch(url, { method: 'POST', headers: buildPinataHeaders(), body: JSON.stringify(body) } as any);
    if (!res.ok) {
      let message = `Pinata upload failed: ${res.status}`;
      try { const j = await res.json(); if (j?.error) message = String(j.error); } catch {}
      throw new Error(message);
    }
    const out = await res.json() as any; // { IpfsHash: string, PinSize, Timestamp }
    const cid: string = out?.IpfsHash || out?.ipfsHash || '';
    if (!cid) throw new Error('Pinata returned no CID');
    const gateway = getGatewayBase();
    const publicUrl = `${gateway}/${cid}`;
    return { cid, url: publicUrl };
  }

  // Download JSON from gateway
  static async downloadJson(cid: string): Promise<JsonRecord> {
    const base = getGatewayBase();
    const url = `${base}/${cid}`;
    const res = await fetch(url as any);
    if (!res.ok) throw new Error(`Gateway fetch failed: ${res.status}`);
    try { return await res.json(); } catch { return null; }
  }
}

export default IpfsService;


