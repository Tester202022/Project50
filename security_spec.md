# Security Specification - Boleto Collection

## Data Invariants
1. A boleto must have a valid `asaasId`.
2. A boleto must be linked to an existing client via `clientId`.
3. The `value` must be a positive number.
4. `bankSlipUrl` must be a valid URL.
5. `createdAt` must be a server timestamp or a valid ISO string matching current request time.

## The Dirty Dozen Payloads

1. **Identity Spoofing**: Attempt to create a boleto as an unauthenticated user.
2. **Missing Field**: Create a boleto without `asaasId`.
3. **Negative Value**: Create a boleto with `value: -100`.
4. **Invalid URL**: Create a boleto with `bankSlipUrl: "not-a-url"`.
5. **Junk ID Poisoning**: Create a document with a 2KB junk character string as ID.
6. **Shadow Update**: Attempt to update an immutable field (e.g., `creatorId` if we had one, or `createdAt`).
7. **Type Mismatch**: Send `value: "100.00"` (string instead of number).
8. **Malicious Script**: Inject `<script>alert(1)</script>` into `description`.
9. **Unauthorized List**: Attempt to list all boletos without being signed in.
10. **State Shortcutting**: Attempt to update status from `PENDING` to `RECEIVED` manually (this should only happen via system sync, but if the client does it, we should check permissions).
11. **PII Leak**: Attempt to read another user's private info (if applicable).
12. **Orphaned Write**: Create a boleto for a `clientId` that does not exist in the `/clients` collection.

## Test Runner (Draft)

```ts
import { assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
// ... testing logic here ...
```
