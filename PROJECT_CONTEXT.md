6# 📌 PROJECT_CONTEXT.md

## Smart Chit Fund Management System

---

# 🧠 1. PROJECT OVERVIEW

This project is a **full-stack web application** designed to digitize and automate traditional chit fund systems.

The platform allows:

* Admins to create and manage chit groups, verify member KYCs, and send invitations.
* Members to join chits, accept invitations, submit KYC documents, make installment payments, and bid in auctions.
* Conducting monthly auctions with discount bidding.
* Automatically distributing payouts and managing dues through a system wallet.
* Automatic dues tracking, late-fee penalty applications, pool liquidity audits, and monthly closures via cron background jobs.
* Maintaining transparency, audit logs, and risk control.

Goal:

> Build a **secure, transparent, and scalable chit fund platform** with real-world financial logic.

---

# ⚙️ 2. TECH STACK

Frontend:

* React (Vite)
* Axios (API calls)
* React Router DOM (v7)

Backend:

* Node.js
* Express.js
* node-cron (Scheduled automated jobs)

Database:

* MySQL (mysql2 driver)

Authentication:

* JWT (JSON Web Tokens)
* bcrypt (password hashing)

---

# 📁 3. PROJECT STRUCTURE

## Backend

backend/

* index.js → main server
* db.js → MySQL connection
* .env → environment variables
* schema.sql → MySQL database schema definitions

folders:

* routes/
  * authRoutes.js
  * chitRoutes.js
  * paymentRoutes.js
  * auctionRoutes.js
  * walletRoutes.js
  * notificationRoutes.js
  * dashboardRoutes.js
* controllers/
  * authController.js
  * chitController.js
  * paymentController.js
  * auctionController.js
  * walletController.js
  * notificationController.js
  * dashboardController.js
* middleware/
  * authMiddleware.js
* services/
  * cronService.js → background cron jobs (dues tracking, late fees, automated closures)
* utils/
  * auditLog.js → database audit logging utility
  * chitCalculations.js → dividend, payout, commission, and late fee formulas
  * memberFinance.js → wallet transactions and penalty applications
  * monthlyPools.js → monthly collection tracking and validation
* migrations/
  * 001_upgrade_chits_table.sql
  * 002_cashflow_safe_auction_logic.sql

---

## Frontend

new_react/

* src/
  * pages/
    * Login.jsx
    * Register.jsx
    * AdminDashboard.jsx
    * MemberDashboard.jsx
    * CreateChit.jsx
    * ChitDetailsPage.jsx
    * AuctionPage.jsx
    * PaymentPage.jsx
    * WalletPage.jsx
    * MonthlyReport.jsx
    * ViewChits.jsx
  * components/
    * KYCModal.jsx
    * ProtectedRoute.jsx
  * api/
    * client.js → Axios base API client
    * authApi.js
    * chitApi.js
    * paymentApi.js
    * auctionApi.js
    * walletApi.js
    * dashboardApi.js
  * App.jsx → Route definitions
  * index.css → Global UI styling
  * main.jsx

---

# 🗄️ 4. DATABASE STRUCTURE

Database Name:
chit_platform

## Core Tables:

### users
* user_id (PK)
* name
* phone (UNIQUE)
* email (UNIQUE)
* password_hash
* role (ADMIN / MEMBER)
* verification_status (PENDING / VERIFIED / REJECTED)
* merit_score (reliability/credit rating, defaults to 100)
* created_at

### chits
* chit_id (PK)
* group_name
* admin_id (FK to users)
* chit_value
* start_date
* end_date
* monthly_due_date
* grace_period_days
* duration_months
* total_members
* minimum_members_required
* minimum_collection_required
* monthly_installment
* late_fee_rate (defaults to 2% / 0.0200)
* admin_commission_rate (defaults to 5% / 0.0500)
* reserve_rate (defaults to 2% / 0.0200)
* description
* status (ACTIVE / CLOSED / CANCELLED)
* created_at

### chit_invitations
* invitation_id (PK)
* chit_id (FK to chits)
* user_id (FK to users)
* status (PENDING / ACCEPTED / REJECTED)
* created_at

### chit_members
* chit_member_id (PK)
* chit_id (FK to chits)
* member_id (FK to users)
* status (JOINED / ACTIVE / PAID_CURRENT / DEFAULTER / COMPLETED / LEFT)
* unpaid_streak
* has_won_auction (boolean tracker)
* joined_at

### payments
* payment_id (PK)
* chit_id (FK to chits)
* member_id (FK to users)
* installment_number
* due_date
* paid_at
* amount_due
* late_fee
* amount_paid
* payment_mode
* payment_status (PAID_ON_TIME / LATE_PAYMENT / UNPAID)
* notes
* created_at

### penalties
* penalty_id (PK)
* payment_id (FK to payments, nullable)
* chit_id (FK to chits)
* member_id (FK to users)
* installment_number
* penalty_type (LATE_FEE / DEFAULTER)
* rate_applied
* amount
* reason
* status (PENDING / APPLIED / WAIVED)
* created_at

### monthly_pools
* pool_id (PK)
* chit_id (FK to chits)
* installment_number
* expected_amount
* pool_amount
* paid_member_count
* required_member_count
* minimum_collection_required
* pending_installment_amount
* auction_id
* auction_winner_id (FK to users)
* discount_percent
* discount_amount
* commission_amount
* reserve_amount
* winner_payout
* distributed_discount_amount
* status (COLLECTING / READY / LOCKED / SETTLED / CANCELLED)
* manually_approved
* approved_by (FK to users)
* approved_at
* created_at
* updated_at

### auctions
* auction_id (PK)
* chit_id (FK to chits)
* installment_number
* pool_id (FK to monthly_pools)
* pool_amount
* paid_member_count
* admin_commission_amount
* reserve_amount
* auction_base_amount
* winning_member_id (FK to users)
* winning_discount_percent
* winning_discount_amount
* winning_payout
* distribution_per_member
* distributed_discount_amount
* eligible_dividend_count
* manually_approved_partial
* status (OPEN / COMPLETED / CANCELLED)
* started_at
* closed_at

### bids
* bid_id (PK)
* auction_id (FK to auctions)
* chit_id (FK to chits)
* member_id (FK to users)
* discount_percent
* discount_amount
* estimated_payout
* distribution_per_member
* bid_at
* is_winner (boolean)

### wallets
* wallet_id (PK)
* user_id (FK to users)
* balance
* updated_at

### transactions
* transaction_id (PK)
* wallet_id (FK to wallets)
* amount
* type (DEPOSIT / WITHDRAWAL / INSTALLMENT_PAYMENT / AUCTION_WINNING / DIVIDEND / LATE_FEE / COMMISSION / RESERVE / ADJUSTMENT)
* reference_id
* reference_type (PAYMENT / AUCTION / SYSTEM)
* description
* created_at

### notifications
* notification_id (PK)
* user_id (FK to users)
* type
* message
* is_read (boolean)
* created_at

### audit_logs
* audit_id (PK)
* user_id (FK to users, nullable)
* action_type
* reference_type
* reference_id
* details (JSON)
* created_at

### monthly_reports
* report_id (PK)
* chit_id (FK to chits)
* month_number
* collected_amount
* pending_amount
* paid_count
* unpaid_count
* created_at

---

# ✅ 5. FEATURES IMPLEMENTED

✔ **Authentication & KYC Security**:
  * User registration and JWT-based secure login.
  * Role-based route protection (`ADMIN` / `MEMBER`).
  * Aadhaar, PAN, and Bank details submission via KYC modal.
  * Admin review and verification status approval dashboard.
  * User reliability metrics tracking via a `merit_score`.

✔ **Chit Group Management**:
  * Admin creation of chit groups with customizable configurations (total value, duration, member caps, commission rates, grace periods, reserve rates).
  * Direct joining by members or structured invitation system (Admin invites → Member accepts invitation).

✔ **Bidding & Auctions**:
  * Live Auction page showing countdown timer, highest bid, and live bidding inputs.
  * Automated auction winner determination (lowest payout corresponding to the highest discount bid).
  * Payout calculations including administrative fee deductions, reserve fundings, and dividend distributions.

✔ **Installment Payments**:
  * Detailed payment tracking with month-by-month installments.
  * Automatic late fee calculation on payments made past the grace period.
  * Integrated virtual wallets supporting deposits, withdrawals, and dividend distributions.

✔ **Automated Operations (Cron Service)**:
  * Periodic background check for overdue installments.
  * Auto-generation of late fees and penalties.
  * System audit logging for critical operations.
  * Auto-closures of monthly pools and auction status progressions.

✔ **Financial Insights**:
  * Dynamic dashboards for Admins (system revenue, user counts, collections, pending reports, and logs) and Members (wallet balances, joined groups, active bids, and notification alerts).
  * Auto-generation of Monthly reports for revenue auditing and defaulters identification.

---

# 🚧 6. CURRENT PROGRESS

The application is now a **fully functional end-to-end prototype** supporting:
* Admin and Member secure login/signup.
* KYC verification workflow.
* Chit group definition, invitations, and membership tracking.
* Automated installment due generation.
* Interactive bidding portal with instant winner selection.
* Wallet system for deposits, payment of dues, and withdrawal of payouts/dividends.
* Robust cron-based backend service.
* Complete database logging.

---

# 🔜 7. NEXT FEATURES TO BUILD

## Immediate Next
1. Integrate real-world payment gateway (e.g., Stripe, Razorpay) for adding wallet funds and withdrawing payouts.
2. Complete SMS and email notification channels (e.g., Twilio, SendGrid) to replace internal notifications for critical actions (due dates, winning alerts).

---

## After That
3. Advanced analytics and charts on dashboards (e.g., Recharts for visual progress of wallet balances/commission revenues).
4. Export reports to PDF/Excel formats for administrative auditing.
5. Legal e-signature integrations for chit membership agreements.

---

# 💰 8. BUSINESS LOGIC RULES

## Chit Rules
* Admin configures total chit value, duration, monthly installments, grace period, and commission rate.
* Members can only join chits if their KYC status is verified (`VERIFIED`).
* Installment dues must be cleared on or before the monthly due date + grace period.

## Auction Rules
* Open monthly auctions run for each active installment.
* Members submit bids indicating their accepted discount percentage (e.g., bidding 20% discount on a $10,000 chit means accepting an $8,000 payout).
* The winner is the member who bids the highest discount (thus taking the lowest payout).
* A member can only win an auction **once** during the entire chit duration.

## Deductions & Payouts
* The winner's payout is calculated as:
  `payout = chit_value * (1 - winning_discount_percent) - admin_commission - reserve_deduction`
* Additionally, any existing overdue payments or late fees of the winner are deducted directly from their payout before the balance is credited to their wallet.
* The remaining amount of the discount (discount amount minus admin commission and reserve fund) is divided equally among all eligible members of the chit group as a dividend and credited to their wallets.

## Eligibility
* A member cannot bid if they have already won a previous auction in that chit.
* A member cannot bid if they have active dues beyond the allowed threshold (e.g., unpaid dues for 2+ months).

---

# 🔐 9. SECURITY & CONTROL
* Passwords securely hashed with bcrypt.
* JWT authentication for protected API endpoints.
* Role-based access control (RBAC) enforced on the backend.
* Database-driven transaction ledger tracking deposits, withdrawals, payments, dividends, and payouts.
* Audit trail logging every administrative or system action.

---

# 🧠 10. SYSTEM FLOW
Register → Submit KYC → Admin approval → Invite to Chit → Accept Invitation → Pay monthly installment → Participate in Auction → Bid → Select Winner → Distribute Dividends → Settle Pool → Month Closure

---

# 🎯 11. CURRENT FOCUS
👉 Integration of third-party APIs (payment gateways & notification services).

---

# 📝 12. NOTES
* Backend server: `http://localhost:5000` (Node.js/Express)
* Frontend server: `http://localhost:5173` (Vite/React)
* Cron jobs run automatically to enforce business logic deadlines.

---

# 🚀 END GOAL
A fully compliant, secure, production-ready chit fund application implementing transparent peer-to-peer savings-credit circles.

---

# 🔥 STATUS

🟢 Authentication & KYC complete
🟢 Chit & invitation management complete
🟢 Bidding & Live Auction system complete
🟢 Wallet, payments & transaction ledger complete
🟢 Cron services and audit logging complete
🟢 Admin & Member Dashboards fully connected
