# Predictive_Maintenance_Failure_Prevention_System

Research-oriented gearbox predictive maintenance with dataset uploads, explainable alerts, and web and mobile dashboards.

---

## Project Identity

- **Project Title:** AI-Based Predictive Maintenance and Failure Prevention System for Mechanical Systems
- **Initial Target Machine:** Industrial Multi-Stage Gearbox (Planetary / Helical Transmission)
- **Product Goal:** Allow authorized factory managers and technicians to upload historical machine datasets, review explainable condition warnings, evaluate data sufficiency, and record immutable maintenance actions.

---

## System Architecture

The project is structured as a manageable JavaScript monorepo:

```
Predictive_Maintenance_Failure_Prevention_System/
├── apps/
│   ├── web/                  # React 18 + Vite (Responsive Desktop/Tablet Web App)
│   ├── mobile/               # React Native + Expo (Field Technician Mobile App)
│   └── server/               # Node.js + Express REST API
├── packages/
│   └── shared/               # Shared constants, gearbox signals, and API contracts
├── docs/
│   ├── architecture.md       # High-level architecture and data-flow diagrams
│   └── roadmap.md            # Comprehensive 12-phase research & product roadmap
├── uploads/                  # Local filesystem storage for uploaded raw CSVs (ignored)
├── LICENSE                   # MIT License
└── package.json              # Monorepo workspace orchestration
```

For comprehensive details on security scoping, signal definitions, and decoupled analysis pipelines, see [docs/architecture.md](docs/architecture.md).

---

## Prerequisites

- **Node.js:** v18.0.0 or higher (v20+ recommended; verified on Node v26)
- **npm:** v9.0.0 or higher
- **MongoDB (Optional for Phase 1):** MongoDB v6.0+ or a MongoDB Docker container. The Express backend is designed with a non-blocking database connector and will boot in offline database mode if MongoDB is not present, ensuring health probes and UI scaffolds remain testable.
- **Mobile Emulators / Expo Go (Optional):** Xcode Simulator (macOS/iOS), Android Studio Emulator (Android), or the Expo Go mobile app on a physical device.

---

## Quickstart & Installation

### 1. Install Dependencies

From the repository root:

```bash
npm install
```

This installs all dependencies across the workspace (`apps/web`, `apps/mobile`, `apps/server`, `packages/shared`) and links the local `@predictive-maintenance/shared` package.

### 2. Environment Configuration

Copy the `.env.example` templates in each app:

```bash
# Server configuration
cp apps/server/.env.example apps/server/.env

# Web client configuration
cp apps/web/.env.example apps/web/.env

# Mobile client configuration
cp apps/mobile/.env.example apps/mobile/.env
```

Default settings work out of the box for local development.

### 3. Start the Backend API Server

```bash
npm run dev:server
```

The server will start on `http://localhost:5001`.
- **Health Check Endpoint:** `http://localhost:5001/api/health`
- **Liveness Probe Endpoint:** `http://localhost:5001/api/liveness`

### 4. Start the Web Application

In a separate terminal:

```bash
npm run dev:web
```

Open `http://localhost:5173` in your browser. The web app will render the Phase 1 Foundation interface and automatically probe the backend API server.

### 5. Start the Mobile Application (Expo)

In a separate terminal:

```bash
npm run dev:mobile
```

This launches the Expo Metro development server:
- Press `i` to open in iOS Simulator (requires macOS with Xcode).
- Press `a` to open in Android Emulator (requires Android Studio).
- Press `w` to run in web mode.
- Scan the displayed QR code with the **Expo Go** app on your physical mobile device.

*Note for mobile testing:* When testing on a physical device or emulator, update `EXPO_PUBLIC_API_BASE_URL` in `apps/mobile/.env` to point to your machine's local IP address (e.g. `http://192.168.1.50:5001/api`) or `http://10.0.2.2:5001/api` for Android emulator.

---

## Database Configuration (MongoDB)

The API server connects to MongoDB via Mongoose using `MONGODB_URI` from `.env`.

### Running MongoDB Locally

Using Docker:
```bash
docker run -d -p 27017:27017 --name pm-mongo mongo:latest
```

Or using Homebrew (macOS):
```bash
brew services start mongodb-community
```

If MongoDB is unavailable, the backend gracefully starts and reports `"status": "disconnected"` in the `/api/health` response without terminating the server.

---

## Development Database Seeder & Test Suite

### Seed Local Demo Accounts & Gearbox Assets

Populate development database with Detroit Plant #2 (`manager@detroit.factory`, `tech@detroit.factory`, `viewer@detroit.factory`, `GB-104`, `GB-201`) and Cleveland Plant #1 (`GB-999` for cross-factory isolation tests):

```bash
npm run seed
```

### Run Automated Security & Scoping Tests

Verify authentication, server session revocation, role gating, and cross-factory 404 isolation:

```bash
npm run test:server
```

---

## Phase Verification Status

### Phase 1: Project Foundation Scaffold
- [x] Monorepo workspace structure (`apps/web`, `apps/mobile`, `apps/server`, `packages/shared`)
- [x] Shared domain definitions (`USER_ROLES`, `GEARBOX_SIGNALS`, `ALERT_SEVERITIES`)
- [x] Express backend with `/api/health` and `/api/liveness` probes
- [x] Non-blocking MongoDB connection handling with graceful offline mode
- [x] React 18 + Vite web client scaffold with real-time API health probe
- [x] React Native + Expo mobile client scaffold with API connectivity tester
- [x] `.gitignore` updated with Expo, uploads, and local runtime rules
- [x] `.env.example` templates with placeholders only (zero secrets)
- [x] Architecture and roadmap documentation in `docs/`
- [x] MIT License preserved

### Phase 2: Industrial Design System & Product Shells
- [x] Charcoal/slate industrial theme with high-contrast accessibility across web and mobile
- [x] Reusable component system: `Card`, `StatusBadge`, `Button`, `MetricSummary`, `AlertCallout`
- [x] Web responsive navigation shell with all required condition-monitoring routes
- [x] Mobile technician shell with Expo bottom navigation and machine/alert drilldowns
- [x] Prominent `DEMO` and `SIMULATED` status badges on all mock equipment

### Phase 3: Authentication, Roles & Scoped Access Enforcement
- [x] MongoDB models for `Organization`, `Factory`, `Site`, `Machine`, `User`, and `Session`
- [x] Server-side session management with SHA-256 token hashing and instant revocation
- [x] Dual auth middleware: `HttpOnly` cookies for web + `Bearer` tokens for mobile
- [x] Role-based access control (`factory_manager`, `technician`, `viewer`)
- [x] Cross-factory privacy enforcement (404 Not Found prevents cross-factory ID enumeration)
- [x] Web `AuthContext`, `LoginPage`, session loading states, and dev quick-login buttons
- [x] Mobile `expo-secure-store` session management, `LoginScreen`, and auto-logout on 401
- [x] Automated test suite in `apps/server/tests/auth-and-scope.test.js` (9/9 tests passing)
- [x] Development database seeder command (`npm run seed`)

---

## Next Phase

**Phase 4:** Factory, site, and gearbox machine management workflows (kinematics, gear ratios, stages, lubrication, and monitored sensor channels).

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
