# ADR-0015: WebAuthn library selection (@simplewebauthn)

- **Status:** Accepted
- **Date:** 2026-10-28
- **Decision-maker:** Ahmed Tarek / Team Hesba

## Context
Phase 2.2 introduces passwordless authentication using WebAuthn Passkeys (`docs/01-product.md` decision D27). WebAuthn ceremonies involve complex CBOR, COSE public key parsing, DER-to-raw signature validation, authenticator data flags checking, and client data JSON validation. Hand-rolling cryptographic attestation and assertion parsing in TypeScript is error-prone, violates security best practices, and creates severe vulnerability risks.

## Options
1. **Option A: `@simplewebauthn/server` and `@simplewebauthn/browser`**
   - *Pros:* The standard, actively maintained reference implementation for WebAuthn/Passkeys in TypeScript/JavaScript; zero native C++ binaries; fully compatible with Node.js runtime and Next.js App Router; supports L2/L3 WebAuthn specifications; clean tree-shakeable API for `generateRegistrationOptions`, `verifyRegistrationResponse`, `generateAuthenticationOptions`, and `verifyAuthenticationResponse`.
   - *Cons:* External dependency in `package.json`.
2. **Option B: Hand-rolled WebCrypto implementation**
   - *Pros:* Zero additional npm packages.
   - *Cons:* High maintenance burden; risk of cryptographic timing/parsing flaws; ASN.1/DER/COSE parsing edge cases; lacks ongoing security audits from the W3C WebAuthn community.

## Decision
We select **Option A (`@simplewebauthn/server` and `@simplewebauthn/browser`)**.

## Consequences
- **Positive:**
  - Robust, standards-compliant Passkey registration and authentication ceremony.
  - Full support for counter checking, user verification, RP ID, origin enforcement, and transports.
  - Clean separation between server verification and browser helper utilities.
- **Negative/risks:**
  - Need to ensure package updates are tracked via Dependabot.
