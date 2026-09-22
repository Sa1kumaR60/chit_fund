# KYC TEST REPORT

**Application:** Smart Chit Fund (chit_fund) — React (Vite) frontend, Express/MySQL backend
**Scope:** KYC module end-to-end (member submission, status lifecycle, admin review, security, DB integrity, chit-fund join integration)
**Method:** Live execution — backend + Vite started, direct API testing (Node/fetch), MySQL inspection after each operation, and real-browser UI testing (headless Chrome via puppeteer-core, 4 screenshots captured)
**Date:** 2026-09-07 to 2026-09-13
**Test data:** 100% synthetic accounts only (random phones, `@test.local` emails, format-valid but fake PAN/Aadhaar). No real Aadhaar/PAN/bank details used. Pre-existing personal accounts (user_id 6 and 7) were verified untouched.

---

## Overall Result

**PASS WITH ISSUES**

The KYC module works end-to-end and the chit-join gate is genuinely enforced server-side. However, **two High-severity security issues** were confirmed live: a legacy endpoint that auto-verifies identity with no admin review/record/audit, and enabled public admin registration (anyone can create an ADMIN and reach the KYC review queue). Several Medium/Low robustness bugs were also confirmed.

| Area | Result |
|---|---|
| 1. Registration | PASS |
| 2. Submission | PASS (issues B4/B7/B12) |
| 3. Database storage | PASS |
| 4. Status tracking | PASS (issue B5) |
| 5. Admin verification | PASS |
| 6. Rejection flow | PASS |
| 7. Member access control | PASS |
| 8. Admin access control | **FAIL** (public admin registration — B2) |
| 9. Chit integration | PASS (issue B11) |
| 10. API security | **FAIL** (legacy verification bypass — B1; all other authz/IDOR/token tests passed) |

Test harness summary: **API/DB phases 132 checks, 128 passed / 4 failed** (all 4 failures were real findings); **UI phases 33 checks, 3 failed** (1 real finding B6, 1 resolved timing artifact, 1 expected console noise). See Evidence Appendix.

---

## 1. Documented KYC flow (as discovered before testing)

### Frontend
| Concern | Location |
|---|---|
| Member KYC form + admin review queue | [ProfilePage.jsx](new_react/src/pages/ProfilePage.jsx) (tabs "KYC & Verification", "KYC Review Queue") |
| Legacy KYC modal (auto-verify) | [KYCModal.jsx](new_react/src/components/KYCModal.jsx) — called from [MemberDashboard.jsx:75](new_react/src/pages/MemberDashboard.jsx:75) |
| Route guards | [ProtectedRoute.jsx](new_react/src/components/ProtectedRoute.jsx), routes in [App.jsx](new_react/src/App.jsx) |
| API clients | [profileApi.js](new_react/src/api/profileApi.js), [authApi.js](new_react/src/api/authApi.js), [client.js](new_react/src/api/client.js) |

### Backend APIs
| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/profile/kyc` | Member JWT | Submit PAN/Aadhaar (+ optional document) → PENDING |
| `GET /api/profile/kyc` | Member JWT | Own status + masked values + history timeline |
| `GET /api/profile/kyc/document/:kycId` | Owner or ADMIN | Stream stored private document |
| `GET /api/profile/admin/kyc-queue` | ADMIN | List PENDING submissions (masked) |
| `POST /api/profile/admin/review-kyc` | ADMIN | Approve (VERIFIED) / Reject (reason mandatory) |
| `POST /api/auth/kyc` (legacy) | Member JWT | **Auto-sets `users.verification_status = 'VERIFIED'`** |

Relevant code: [profileController.js](backend/controllers/profileController.js), [kycAdminController.js](backend/controllers/kycAdminController.js), [authController.js:534](backend/controllers/authController.js:534), [authMiddleware.js](backend/middleware/authMiddleware.js), [storageService.js](backend/services/storageService.js), [encryptionService.js](backend/services/encryptionService.js).

### Database
- `user_kyc`: `kyc_id` PK, `user_id` **UNIQUE**, `pan_number_masked`, `pan_number_hash` (SHA-256), `aadhaar_number_masked`, `aadhaar_number_hash`, `id_document_path`, `status` ENUM(PENDING/VERIFIED/REJECTED), `rejection_reason`, `verified_by`, `verified_at`, `submitted_at`, `updated_at`. FKs to `users` with ON DELETE **RESTRICT**.
- `user_kyc_history`: immutable timeline; `action_type` ENUM(SUBMITTED/VERIFIED/REJECTED/**RESUBMITTED**), `performed_by`, `performed_at`.
- `users.verification_status` ENUM(PENDING/VERIFIED/REJECTED) is a **denormalised mirror** (the join gate does *not* trust it — see §7).
- Join gate: `chitController.claimInvitationByToken` requires `user_kyc.status = 'VERIFIED'`, else HTTP 403 `{ kycRequired: true }`.

### Status transitions observed
`(none) → PENDING` (submit) `→ VERIFIED` (admin) or `→ REJECTED` (admin + reason) `→ PENDING` (resubmit) `→ VERIFIED`.

---

## 2–3. Member KYC registration, submission & validation (actual results)

**Registration/login (15 checks, all PASS):** UI + API registration, duplicate phone → 400, wrong password → 401, unknown user → 401, new users default `verification_status = PENDING`, wallet auto-created.

**Input validation (24 PASS / 1 FAIL):**
- No token → **401**; empty body / missing PAN / missing Aadhaar / empty strings / whitespace → **400** with specific messages; no DB row created.
- Invalid PAN (9/11 chars, all letters), invalid Aadhaar (11 digits, letters) → **400**.
- 10,000-char strings → **400**; SQLi payloads (`' OR '1'='1`, `; DROP TABLE users;--`) → **400**, tables intact; XSS payloads → **400**.
- `PUT`/`DELETE /api/profile/kyc` → **404** (no such routes).
- Lowercase PAN and space-grouped Aadhaar are normalised and accepted (200) — by design; masked/hash values stored correctly.
- **FAIL — B4a:** `POST /api/profile/kyc` with `Content-Type: text/plain` → **HTTP 500** `"Cannot destructure property 'pan_number' of 'req.body' as it is undefined"` (should be 400).

**Submission & documents (19 PASS / 2 FAIL):**
- Valid synthetic PAN+Aadhaar → **200**; `user_kyc` row PENDING; PAN masked `ABCDE****F`; Aadhaar masked `XXXX-XXXX-9012`; hashes verified equal to SHA-256 of inputs; `users.verification_status` PENDING; `user_kyc_history` SUBMITTED row; `audit_logs` KYC_SUBMITTED row. **No raw PAN/Aadhaar columns exist.**
- Resubmission → upsert, exactly **1 row** (unique user_id), history appends.
- Duplicate PAN or Aadhaar on another account → **400** with explicit message; no row created.
- Valid PDF upload → 200, file stored under `backend/storage/private_kyc_docs/kyc-doc-<32hex>.pdf`.
- Path-traversal filename (`..\..\..\windows\evil.pdf`) → neutralised (server generates a random name; extension whitelist).
- Oversized document (1.2 MB) → **413 Payload Too Large**.
- **FAIL — B4b:** invalid extension `.exe` / `.html` → **HTTP 500** (message "Invalid document format. Allowed: PDF, JPG, PNG.") instead of a clean **400**.
- **Finding B3:** executable content (`MZ…`) renamed `document.pdf` → **accepted (200) and stored**; no magic-byte/content validation.

---

## 4. KYC status tracking

- Initial status **PENDING** in DB and UI.
- Correct `user_id` association; **one row per user** (UNIQUE index verified).
- Persists across page refresh, logout/login and 6-day-old expired token (re-login) — verified in API and UI.
- No conflicting duplicate records; resubmission updates the same row.
- **B5:** a **VERIFIED** member can resubmit through the API and silently drop back to PENDING (the UI hides the form, the API does not block it). The masked PAN/Aadhaar display looks unchanged, so only hashes/history reveal the change.

---

## 5–6. Admin verification & rejection

**Queue (all PASS):** member token → **403**; admin sees PENDING list including the correct member with **masked** PAN/Aadhaar only (no hashes, no document path); approved records leave the queue.

**Approve (all PASS):** HTTP 200 → `user_kyc.status=VERIFIED`, `verified_by`/`verified_at` set, `users.verification_status=VERIFIED`, history VERIFIED entry with admin actor, `KYC_STATUS` notification created, `audit_logs` KYC_VERIFIED. Member sees VERIFIED immediately and after re-login.

**Reject (all PASS):** rejection **without reason → 400**; with reason → 200 → `user_kyc.status=REJECTED` + reason persisted, `users.verification_status=REJECTED`, history REJECTED with reason; member sees status and reason. Resubmission after rejection → PENDING (reason cleared) → can be approved again.

Other checks: invalid decision value → 400; missing `kycId` → 400; non-existent `kycId` → 404; admin cannot be impersonated by a member (403).

**Finding B6 (UI):** `ProtectedRoute` sends role-mismatched users to `/` (login) whose mount **clears `localStorage`**, so a member who opens `/admin` (link, bookmark, back button) is **force-logged-out** (`tokenBefore=true → tokenAfter=false`). Expected: redirect to `/member` without destroying the session.

**Finding B6b (UX):** the admin review panel shows only masked PAN/Aadhaar — **there is no button to view the uploaded document**, although `GET /api/profile/kyc/document/:kycId` supports it. Admin therefore approves documents unseen.

---

## 7. Security testing

| Check | Actual result |
|---|---|
| Member token on `GET/POST /api/profile/admin/*` | **403** blocked (all attempts) |
| Forged JWT with `role:"ADMIN"` for a member (valid signature) | **403** — middleware reloads role from DB (good) |
| Forged ADMIN token on review endpoint | 403, no state change |
| Missing token | 401 |
| Malformed/invalid token | 403 "Invalid token" |
| Token signed with wrong secret | 403 |
| Expired token (`exp:-1h`) | 403 |
| Token for non-existent user | 401 "User account no longer exists" |
| Stale `token_version` | 401 "Password was recently changed or session revoked" |
| IDOR — member streaming another member's document by `kycId` | **403** (record exists, ownership enforced) |
| Non-numeric / non-existent `kycId` | 404 |
| Owner/admin document streaming | 200 (Cache-Control: private, no-store) |
| Member changing IDs in API bodies/URLs to read others' KYC | No endpoint accepts a target user id; identity always from JWT |
| SQL injection through PAN/Aadhaar | Rejected by format validation; parameterised queries used |
| XSS through PAN/Aadhaar/document name | Rejected / not rendered; server renames uploads |
| Sensitive data in server logs | **NONE** (scanned all captured backend logs for every synthetic PAN/Aadhaar — 0 hits) |
| Sensitive data in browser console | **NONE** (44 console entries captured; 0 PII hits) |
| API over-exposure | `GET /profile/kyc` returns masked values only (no hashes, no document path) |

### Security Vulnerabilities (confirmed live — separate from functional bugs)

**V1 — HIGH: Legacy `POST /api/auth/kyc` auto-verifies identity without any review.**
Any logged-in member can send a format-valid PAN/Aadhaar and receive HTTP 200 `"KYC verified successfully"`. Verified effects: `users.verification_status` becomes **VERIFIED** while **zero** `user_kyc` / `user_kyc_history` / `audit_logs` records are created, no document, no admin action. The member's profile/badge shows **KYC VERIFIED**, and the member is **invisible to the admin KYC queue** (which only lists `user_kyc` PENDING rows). The old `KYCModal.jsx` still calls this endpoint, so it remains reachable from the member dashboard's KYC prompt.
*Mitigation note:* the chit-join gate correctly checks `user_kyc.status`, so this does **not** directly unlock chit joining (verified: such a member is still blocked with 403 `kycRequired`). The impact is a false verification state across every consumer of `users.verification_status`, plus a broken "verified but cannot join" UX and a missing audit trail.

**V2 — HIGH: Public admin registration is enabled (`ALLOW_PUBLIC_ADMIN_REGISTRATION=true`).**
Verified two ways: API registration with `role:"ADMIN"` returns 200/role ADMIN, and the Register UI exposes the option "Admin (First setup only)". Anyone can self-provision an ADMIN account and then access the KYC queue/review endpoints — i.e., read members' masked KYC data, and approve/reject anybody's KYC. This was previously flagged (2026-06-29) and remains unfixed.

**V3 — MEDIUM: File-upload hardening gap.** Extension-only whitelist; executable bytes renamed `.pdf` are stored; no content/MIME validation, no malware scan; admins cannot open the document in the UI (B6b), so disguised payloads can be approved unseen. Stored files are served only through the authenticated/authorised endpoint (no direct static exposure observed).

---

## 8. Database verification

All 14 integrity checks passed, except one data-hygiene finding:

| Check | Result |
|---|---|
| Record created correctly, correct user relationship | PASS |
| Status updated correctly on approve/reject/resubmit | PASS |
| Duplicate records prevented (`UNIQUE(user_id)`, `uq_chit_member`) | PASS |
| FK constraints present, all `ON DELETE RESTRICT` (KYCs cannot be silently deleted) | PASS |
| Timestamps sane (`verified_at ≥ submitted_at`) | PASS |
| Rejected/approved records retained (not deleted) | PASS |
| No raw PAN/Aadhaar stored (masked + SHA-256 only) | PASS |
| Hash values recomputed and matched inputs (B/D/E/F) | PASS |
| Existing user/chit data not corrupted (accounts 2, 6, 7 unchanged) | PASS |
| Wallets auto-created for all new users | PASS |
| History chain preserved through reject→resubmit→approve | PASS |

**Finding B9 (data hygiene):** KYCs submitted **without a document** store the path `storage/private_kyc_docs/default-placeholder.pdf`, but that file does not exist on disk → streaming returns 404. Real uploads are stored as **absolute** paths while the placeholder is **relative**, so resolution depends on the server's working directory. A pre-existing row (user_id 2) references `storage/private_kyc_docs/test.pdf`, which is also missing. Also, the no-document path is accepted silently, so "document proof" is optional despite the UI marking the file input `required`.

---

## 9. Chit fund integration (KYC gate)

Server-side gate confirmed at `chitController.claimInvitationByToken` (checks `user_kyc.status === 'VERIFIED'`).

| Member state | Join attempt result |
|---|---|
| No `user_kyc` row, but `users.verification_status = VERIFIED` (via legacy endpoint) | **403** `kycRequired` — gate does not trust the users table |
| PAN/Aadhaar submitted, status PENDING | **403** |
| Rejected by admin | **403** |
| After admin approval (VERIFIED) | **200**, membership row created with correct `member_id` |
| Approved member re-logged in | still allowed; state is DB-backed not client state |

DB after the gate tests: `chit_members` contained exactly the verified members; the blocked member had **no** membership row; the invitation for the joined member was set ACCEPTED and bound to the correct `user_id`; blocked members' invitations stayed PENDING. No alternate code path inserts into `chit_members` (only `claimInvitationByToken`), and the legacy auto-verify could not bypass the gate.

**Finding B11 (design risk):** the invitation token behaves as a bearer credential — a *different* verified member who possesses an invitee's token can claim that slot (verified: invitation rebound to the claimant). Tokens are high-entropy (24 random bytes) and only returned to the invitee, so exploitation requires token leakage/forwarding; still, an ownership check against the recorded invitee phone/email/user id is advisable.

Frontend note: the "Accept Invitation" handler in `MemberDashboard` calls `POST /api/chits/invitations/:id/accept`, a route that **no longer exists** (404) — that button path is dead; the live flow is `claim-invite` with a token.

---

## 10. Bugs Found

### B1 — Legacy KYC endpoint performs silent auto-verification (bypasses admin review)
- **Severity: High (security + business logic)**
- **Reproduce:** log in as any member → `POST /api/auth/kyc` with `{aadhar_number:"…12 digits…", pan_number:"ABCDE1234F"}` → 200 "KYC verified successfully".
- **Expected:** create a PENDING submission for admin review (as `/api/profile/kyc` does).
- **Actual:** `users.verification_status` set to VERIFIED instantly; no `user_kyc` row, no history, no audit, no document; profile shows VERIFIED; admin queue does not show the member.
- **Frontend:** [KYCModal.jsx](new_react/src/components/KYCModal.jsx) (invoked from MemberDashboard)
- **Backend:** [authController.js:534](backend/controllers/authController.js:534), route in [authRoutes.js:9](backend/routes/authRoutes.js:9)
- **DB impact:** inconsistent `users.verification_status` vs `user_kyc`; audit gap
- **Security impact:** identity verification bypass / false trust state
- **Fix:** remove the endpoint and the modal, or convert it to create a PENDING `user_kyc` submission.

### B2 — Public admin registration enabled
- **Severity: High (security)**
- **Reproduce:** on `/register` select role "Admin (First setup only)" (or `POST /api/auth/register` with `role:"ADMIN"`) → succeeds; then open `/profile` → KYC Review Queue.
- **Expected:** admin accounts only via provisioning; admin endpoints unreachable by self-registered users.
- **Actual:** anyone can become ADMIN and review others' KYC.
- **Backend:** [authController.js:34](backend/controllers/authController.js:34) gated by `ALLOW_PUBLIC_ADMIN_REGISTRATION`; **frontend** [Register.jsx:139](new_react/src/pages/Register.jsx:139)
- **Fix:** set the flag false in all environments; remove the ADMIN option from the public register form.

### B3 — Executable content accepted as a document; no content validation
- **Severity: Medium**
- **Reproduce:** submit KYC with `document_name:"document.pdf"` and `id_document_base64` containing `MZ\x90\x00…` → 200; file stored and referenced in DB.
- **Expected:** reject non-PDF/JPG/PNG content (magic-byte check) and/or scan.
- **Actual:** extension-only validation; combined with no in-UI document viewer, admins can approve unseen payloads.
- **Backend:** [storageService.js:28](backend/services/storageService.js:28)
- **Fix:** verify magic bytes/MIME, cap size server-side, add an admin document viewer.

### B4 — Malformed requests surface as HTTP 500 instead of 400
- **Severity: Medium**
- **B4a:** `POST /api/profile/kyc` with `Content-Type: text/plain` → 500 `Cannot destructure property 'pan_number' of 'req.body'`.
  **B4b:** invalid upload extension → 500.
- **Expected:** 400 with a validation message.
- **Actual:** 500 (unhandled exceptions). Leaks internal error text.
- **Backend:** [profileController.js:109](backend/controllers/profileController.js:109) (unguarded destructure), [profileController.js:146](backend/controllers/profileController.js:146) (storage throw not mapped)
- **Fix:** validate `req.body` shape; wrap storage errors and return 400.

### B5 — VERIFIED member can silently downgrade their own KYC
- **Severity: Medium**
- **Reproduce:** as a VERIFIED member, `POST /api/profile/kyc` again (new PAN/Aadhaar) → 200; status becomes PENDING and the stored PAN/Aadhaar is replaced.
- **Expected:** block resubmission while VERIFIED, or route it through an explicit change-request review.
- **Actual:** silent loss of verified status (member then fails the chit-join gate) and replacement of verified identity data; the masked display is unchanged so it is not visible in the UI.
- **Backend:** [profileController.js:157](backend/controllers/profileController.js:157) (`ON DUPLICATE KEY UPDATE … status='PENDING'`).

### B6 — Member visiting `/admin` is force-logged-out
- **Severity: Medium**
- **Reproduce:** log in as a member → open `/admin`.
- **Expected:** redirect to `/member`, session kept.
- **Actual:** redirected to `/` (login), whose mount clears `localStorage` → session destroyed (`tokenBefore=true` → `tokenAfter=false`); all subsequent API calls 401 until re-login.
- **Frontend:** [ProtectedRoute.jsx:13](new_react/src/components/ProtectedRoute.jsx:13), [Login.jsx:15](new_react/src/pages/Login.jsx:15)
- **Fix:** navigate role mismatches to their own dashboard; do not clear storage outside an explicit logout.

### B7 — Oversized upload gives no useful feedback; limits inconsistent
- **Severity: Low**
- **Reproduce:** attach a 1.2 MB file and submit → HTTP 413, UI shows only "Failed to submit KYC."
- **Expected:** clear "File exceeds size limit" message; UI (2 MB) and server (1 MB JSON limit) agree.
- **Backend:** `express.json({ limit: "1mb" })` in [index.js:26](backend/index.js:26); **frontend** [ProfilePage.jsx:133](new_react/src/pages/ProfilePage.jsx:133).

### B8 — Resubmissions are logged as SUBMITTED, never RESUBMITTED
- **Severity: Low**
- **Actual:** `user_kyc_history.action_type` is always `SUBMITTED` on resubmission although the enum defines `RESUBMITTED`.
- **Backend:** [profileController.js:180](backend/controllers/profileController.js:180).

### B9 — Missing/od placeholder document paths
- **Severity: Low (data hygiene)**
- No-document submissions reference a non-existent `default-placeholder.pdf`; placeholder paths are relative while real uploads are absolute; a pre-existing row references a missing `test.pdf`. Streaming those records returns 404.
- **Backend:** [profileController.js:143](backend/controllers/profileController.js:143), [storageService.js:28](backend/services/storageService.js:28).

### B10 — One of several concurrent submits returns 500
- **Severity: Low**
- **Reproduce:** fire 3 parallel identical `POST /api/profile/kyc` → statuses `200,200,500`; exactly one row is created.
- **Expected:** idempotent success (or a clean 409).
- **Backend:** upsert transaction in [profileController.js:157](backend/controllers/profileController.js:157).

### B11 — Invitation token is a bearer credential (no invitee binding)
- **Severity: Low**
- **Reproduce:** a verified non-invitee submits a valid invitation token for another phone → 200; slot/membership bound to the claimant.
- **Backend:** [chitController.js:382](backend/controllers/chitController.js:382).
- **Fix:** when the invitation has `invitee_phone`/`invitee_email`/`user_id`, require the authenticated user to match.

### B12 — KYC can be submitted before the selected document finishes reading
- **Severity: Low**
- **Reproduce:** choose a file and click Submit immediately → request body contains no document (~109 bytes) and the KYC is stored without proof (document is optional server-side).
- **Frontend:** [ProfilePage.jsx:130](new_react/src/pages/ProfilePage.jsx:130).
- **Fix:** track the FileReader state and block submit until the base64 is ready; if proof is mandatory, enforce it server-side.

### Dead UI path (informational)
`MemberDashboard` "Accept Invitation" calls a removed endpoint (`/api/chits/invitations/:id/accept` → 404). Live flow is the token-based `claim-invite`.

---

## Database Issues

1. **State divergence risk (B1):** `users.verification_status` can be set without a matching `user_kyc` row (legacy endpoint). Recommend deriving the flag from `user_kyc` or removing the mirror.
2. **Missing placeholder file & inconsistent path form (B9):** no-document rows point at a non-existent relative path; a pre-existing row (user_id 2) points at missing `test.pdf`.
3. **`RESUBMITTED` enum unused (B8):** timeline semantics are weaker than designed.
4. **Concurrency (B10):** transaction races surface as 500 while still writing exactly one row.
5. Positive: `UNIQUE(user_id)`, `uq_chit_member`, all KYC FKs `ON DELETE RESTRICT`, masked+hashed storage with no raw PII columns — all verified in the live schema.

---

## Recommendations (prioritised)

**Critical / High**
1. Disable or re-implement the legacy `POST /api/auth/kyc` (B1) and remove `KYCModal`'s use of it.
2. Turn off `ALLOW_PUBLIC_ADMIN_REGISTRATION` and remove the ADMIN option from the public Register form (B2).
3. Add content/magic-byte validation and malware scanning to uploads; add an admin document viewer (B3, B6b).

**Medium**
4. Fix 500s on malformed bodies and invalid upload types → proper 400s (B4).
5. Block KYC resubmission while VERIFIED (or add a change-request workflow) (B5).
6. Fix `ProtectedRoute` to redirect to the user's own dashboard without clearing the session (B6).
7. Bind invitation claims to the recorded invitee when available (B11).
8. Decide and enforce whether an identity document is mandatory; if yes, enforce server-side and ship the placeholder otherwise (B9, B12).

**Low**
9. Align the client/server upload size limits and surface a clear 413 message (B7).
10. Record `RESUBMITTED` in history (B8).
11. Make concurrent submissions idempotent (B10).
12. Fix the dead "Accept Invitation" path and remove obsolete code (dead UI path).

---

## Not Tested (and why)

- **Real payment-gateway / external KYC (Aadhaar/PAN) verification APIs:** not part of this codebase (no such integration exists); all validation is format-based and was tested as such.
- **Time-based KYC expiry / scheduled re-verification:** no such feature exists in the code.
- **Load/performance testing of concurrent KYC submissions at scale:** only a 3-request concurrency probe was run (B10); no load environment was provided.
- **Code fixes:** explicitly out of scope per instructions — no application code was modified.

---

## Evidence Appendix

**Harness (created for this test, left in place):** `qa_tmp/` — `lib.js` (server lifecycle + HTTP + DB), `phases/*.js` (provision, qaadmin, kyc_validation, kyc_submit, docstream, lifecycle, security, chit_gate, dbchecks), `ui_test.js`, `ui_probe.js`, `ui_extra.js`, `state.json`, `ui_results.json`.

**Screenshots:** `qa_tmp/screenshots/01-member-dashboard.png`, `02-member-kyc-form.png`, `03-member-kyc-pending.png`, `04-admin-queue.png`, `05-admin-after-approve.png`, `06-member-verified.png`.

**Logs:** `qa_tmp/logs/server-batch.log`, `ui-backend.log`, `ui-vite.log`, `probe-backend.log`, `extra-backend.log` (scanned: no PII).

**Synthetic test accounts in DB (created by this test):** QA KYC Admin (+rogue admin), members A–F, QA UI Member, QA Probe, QA Rapid. Pre-existing accounts 2, 6, 7 were verified unmodified. No records were deleted; the only cleanup performed was removal of KYC rows that the test itself created for member B during a crashed run.
