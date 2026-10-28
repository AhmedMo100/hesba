import "server-only";
import { env } from "@/server/config/env";

export function getWebAuthnConfig() {
  const origin = env.HESBA_APP_ORIGIN;
  let rpID = "localhost";
  try {
    const url = new URL(origin);
    rpID = url.hostname;
  } catch {
    rpID = "localhost";
  }

  const rpName = "حسبة";

  return {
    rpID,
    rpName,
    origin,
  };
}
