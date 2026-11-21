# Resetting a forgotten password by hand

Hesba has no e-mail recovery: the e-mail is optional at sign-up, and many owners never give one.
On the login screen, «نسيت كلمة المرور؟» tells the owner to contact Hesba:

> نسيت كلمة المرور؟ تواصل مع إدارة حِسبة لمساعدتك في استعادة الحساب.

Hesba's team then issues a **temporary password** with the tool below. The owner signs in with it,
and the app shows only one screen until they choose their own password.

## Who can run this

Only an operator on a trusted machine, with the **migrator** connection string (`HESBA_DIRECT_URL`).
No HTTP endpoint exists for a reset, so it cannot be triggered from the app or the internet. The
app's database roles (`hesba_app`, `hesba_service`) can never put an account into the reset state:
a database trigger refuses it.

## 1. Confirm who is asking

Before any reset, confirm the caller owns the account. For example, they call or message from the
shop's registered phone number, and can name the shop and the governorate shown in
`SELECT * FROM hesba_find_store('01xxxxxxxxx');`. If you are not sure, do not reset.

## 2. Run the tool

```bash
HESBA_DIRECT_URL='postgres://hesba_migrator:…@…/…' \
  pnpm admin:reset-password --phone 01012345678
# or: --email owner@example.com
# optional: --hours 24   (how long the temporary password signs in: 1–72, default 24)
```

The tool shows the account (name, masked phone) and asks you to type `reset`. It then prints the
temporary password **once**, for example `k7Qm-9fTx-Rb2w-H4nP`. Give it to the owner by phone or in
person. Do not paste it into a group chat, a ticket or a file.

In one transaction, the tool:

| Step | Effect |
| --- | --- |
| New password hash | Argon2id, the same parameters as every password (`src/server/modules/auth/password-hash.ts`). The temporary password itself is never stored, logged or written to a file. The old password stops working and cannot be recovered. |
| `must_change_password = true` | Every API answers `403 PASSWORD_CHANGE_REQUIRED`, except reading the session, changing the password and logging out. The rule is enforced on the server (`requireSession`), so no URL or direct API call gets around it. |
| `temp_password_expires_at` | After this time the temporary password no longer signs in. The owner asks again. |
| All sessions revoked | Whoever was signed in, on any device, is signed out at once. |

## 3. What the owner sees

1. They sign in with their phone and the temporary password.
2. The app shows only «غيّر كلمة المرور»: they enter the temporary password, then a new one twice.
   The new one must pass the normal policy and must differ from the temporary one.
3. After saving:
   - the flag and the expiry are cleared;
   - **every other session of the account is closed**, so a temporary sign-in on another device
     ends;
   - this device stays signed in and the app opens normally;
   - the temporary password is dead, because its hash was replaced.

Wrong temporary passwords on the change screen are limited to 5 per 15 minutes for each account.

## Session policy, summarized

| Event | Sessions |
| --- | --- |
| Admin reset | All revoked |
| Password changed (forced or normal) | All others revoked, the current one kept |
| Logout | The current one revoked |

## Passkeys and PIN

Hesba currently signs in only with phone (or e-mail) + password. The `user_passkeys` table exists,
but no route signs in with a passkey or a PIN yet. The temporary-password rule belongs to the
**account**, not to the login method: it is checked in `requireSession` for every session. Any
future passkey or PIN login therefore inherits it, and cannot be used to skip the change.

## Checking an account's state (read-only)

```sql
SELECT name, must_change_password, temp_password_expires_at
  FROM users WHERE phone = '+201012345678';
```
