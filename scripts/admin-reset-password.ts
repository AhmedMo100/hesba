#!/usr/bin/env tsx
/**
 * Hesba — manual password reset by Hesba's team (there is no e-mail recovery).
 *
 * The owner contacts Hesba; after confirming who they are (docs/ops/password-reset.md), an
 * operator runs, on a trusted machine, with the MIGRATOR connection (never shipped to the app):
 *
 *   HESBA_DIRECT_URL=postgres://hesba_migrator:…@…/… \
 *     pnpm exec tsx scripts/admin-reset-password.ts --phone 01012345678
 *   … --email owner@example.com      (instead of --phone)
 *   … --hours 24                      (how long the temporary password signs in; 1–72, default 24)
 *   … --yes                           (skip the confirmation question; for scripted use only)
 *
 * What it does, in ONE transaction:
 *   1. generates a random temporary password (crypto, ~95 bits) that satisfies the password policy;
 *   2. stores ONLY its Argon2id hash (same parameters as every password: src/server/modules/auth/
 *      password-hash.ts) — the old password stops working and can never be recovered;
 *   3. sets `must_change_password` + `temp_password_expires_at`: the account can sign in with it,
 *      but every API answers 403 PASSWORD_CHANGE_REQUIRED until the owner chooses a new password;
 *   4. revokes EVERY session of the account (whoever was signed in, on any device, is signed out).
 *
 * The temporary password is printed ONCE, to this terminal only: it is never logged, written to a
 * file, or stored in the database in plain text. Give it to the owner by phone / in person.
 * There is no HTTP endpoint for this: a reset cannot be triggered from the app or the internet.
 */

import { randomInt } from "node:crypto";
import { createInterface } from "node:readline/promises";
import postgres from "postgres";
import { argon2idHash } from "../src/server/modules/auth/password-hash";
import { validatePasswordPolicy } from "../src/domain/password-policy";

/** No look-alike characters (0/O, 1/l/I): it is read out over the phone. */
const LETTERS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const ALPHABET = LETTERS + DIGITS;

/** Four groups of four, e.g. `k7Qm-9fTx-Rb2w-H4nP`: at least one letter and one digit. */
export function generateTemporaryPassword(): string {
  for (;;) {
    const groups = Array.from({ length: 4 }, () =>
      Array.from(
        { length: 4 },
        () => ALPHABET[randomInt(ALPHABET.length)],
      ).join(""),
    );
    const candidate = groups.join("-");
    if (
      /[0-9]/.test(candidate) &&
      /[a-zA-Z]/.test(candidate) &&
      validatePasswordPolicy(candidate).valid
    ) {
      return candidate;
    }
  }
}

/** Same rule as the app (`normalizePhone`): Egyptian mobiles are stored as `+201…`. */
export function normalizeEgyptPhone(v: string): string {
  let c = v
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[\s\-_]/g, "")
    .trim();
  if (c.startsWith("0020")) c = "+20" + c.slice(4);
  else if (c.startsWith("20") && c.length === 12) c = "+" + c;
  else if (c.startsWith("01") && c.length === 11) c = "+2" + c;
  else if (c.startsWith("1") && c.length === 10) c = "+20" + c;
  return c;
}

interface Args {
  phone?: string;
  email?: string;
  hours: number;
  yes: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const hours = Number(get("--hours") ?? 24);
  if (!Number.isInteger(hours) || hours < 1 || hours > 72) {
    throw new Error("--hours must be a whole number between 1 and 72");
  }
  const args: Args = {
    phone: get("--phone"),
    email: get("--email"),
    hours,
    yes: argv.includes("--yes"),
  };
  if (!args.phone === !args.email) {
    throw new Error("give exactly one of --phone or --email");
  }
  return args;
}

/** `+20101****678` — enough for the operator to confirm, not a full copy in the scrollback. */
function maskPhone(p: string): string {
  return p.length > 7 ? `${p.slice(0, 6)}****${p.slice(-3)}` : "****";
}

export interface ResetResult {
  userId: string;
  revokedSessions: number;
  expiresAt: Date;
}

/**
 * The reset itself (exported for the integration test). Runs as the migrator: the runtime roles
 * cannot set `must_change_password` (database trigger).
 */
export async function resetPasswordForUser(
  sql: postgres.Sql,
  userId: string,
  temporaryPassword: string,
  hours: number,
): Promise<ResetResult> {
  const hash = await argon2idHash(temporaryPassword);
  return await sql.begin(async (tx) => {
    const [u] = await tx<{ expires_at: Date }[]>`
      UPDATE users
         SET password_hash = ${hash},
             must_change_password = true,
             temp_password_expires_at = now() + make_interval(hours => ${hours}),
             updated_at = now()
       WHERE id = ${userId}
      RETURNING temp_password_expires_at AS expires_at`;
    if (!u) throw new Error("account not found");
    const revoked = await tx`
      UPDATE sessions SET revoked_at = now()
       WHERE user_id = ${userId} AND revoked_at IS NULL`;
    return { userId, revokedSessions: revoked.count, expiresAt: u.expires_at };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env["HESBA_DIRECT_URL"];
  if (!url) {
    throw new Error("HESBA_DIRECT_URL (the migrator connection) is required");
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const rows = args.phone
      ? await sql<{ id: string; name: string; phone: string; must: boolean }[]>`
          SELECT id, name, phone, must_change_password AS must FROM users
           WHERE phone = ${normalizeEgyptPhone(args.phone)}`
      : await sql<{ id: string; name: string; phone: string; must: boolean }[]>`
          SELECT id, name, phone, must_change_password AS must FROM users
           WHERE email = ${args.email!.trim().toLowerCase()}`;
    const user = rows[0];
    if (!user) {
      console.error(
        "No account with that phone / e-mail. Nothing was changed.",
      );
      process.exitCode = 2;
      return;
    }

    console.log(`Account: ${user.name} · ${maskPhone(user.phone)}`);
    console.log(
      `This replaces the password, signs the account out everywhere, and forces a new password at the next login (temporary password valid ${args.hours} h).`,
    );
    if (!args.yes) {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const answer = await rl.question('Type "reset" to continue: ');
      rl.close();
      if (answer.trim() !== "reset") {
        console.log("Cancelled. Nothing was changed.");
        return;
      }
    }

    const temporary = generateTemporaryPassword();
    const result = await resetPasswordForUser(
      sql,
      user.id,
      temporary,
      args.hours,
    );
    console.log("");
    console.log(
      "Temporary password (shown once — give it to the owner, do not save it):",
    );
    console.log(`    ${temporary}`);
    console.log("");
    console.log(
      `Valid until ${result.expiresAt.toISOString()} · ${result.revokedSessions} session(s) signed out.`,
    );
  } finally {
    await sql.end();
  }
}

// Run only as a script, not when the test imports the helpers.
if (
  process.argv[1] &&
  /admin-reset-password\.[cm]?[jt]s$/.test(process.argv[1])
) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : "reset failed");
    process.exitCode = 1;
  });
}
