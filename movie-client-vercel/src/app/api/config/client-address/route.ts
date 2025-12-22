import { privateKeyToAccount } from "viem/accounts";

export const runtime = "nodejs";

export async function GET() {
  try {
    const pk = String(process.env.CLIENT_WALLET_EOA_PRIVATE_KEY || "").trim();
    if (!pk || !pk.startsWith("0x") || pk.length !== 66) {
      return Response.json({ clientAddress: "" });
    }
    const account = privateKeyToAccount(pk as `0x${string}`);
    return Response.json({ clientAddress: account.address });
  } catch {
    return Response.json({ clientAddress: "" });
  }
}


