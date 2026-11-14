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

The API server connects to MongoDB via Mongoose using `MONGODB_URI` from `.env` (defaults to `mongodb://localhost:27017/predictive_maintenance`).

### Option A: macOS Homebrew Service

The project runs on MongoDB 8.0 Community Edition. On macOS with the `mongodb/brew` tap, the installed formula is `mongodb-community@8.0`:

1. **Start MongoDB Daemon in Background:**
   ```bash
   mongod --config /opt/homebrew/etc/mongod.conf --fork
   ```
2. **Verify Daemon Health:**
   ```bash
   mongosh --eval "db.adminCommand('ping')"
   # Returns: { ok: 1 }
   ```
3. **Stop MongoDB Daemon (When Done):**
   ```bash
   mongosh admin --eval "db.shutdownServer()"
   # or: pkill mongod
   ```
*Data Persistence:* Data files persist across restarts in `/opt/homebrew/var/mongodb`.

### Option B: Docker Compose

For environments running Docker, a production-grade compose configuration is provided:

1. **Start MongoDB Container:**
   ```bash
   docker compose up -d
   ```
2. **Verify Container Health:**
   ```bash
   docker compose ps
   ```
3. **Stop Container:**
   ```bash
   docker compose down
   ```
*Data Persistence:* Database files persist in the named Docker volume `mongodb_data`.

### Offline Database & Fail-Fast Behavior

If MongoDB is offline:
- Express boots immediately without blocking.
- `/api/health` reports `status: "degraded"` with `api.reachable: true` and `database.connected: false`.
- Authentication endpoints (`/api/auth/login`, `/api/auth/me`) fail fast in < 5ms with HTTP 503 (`DATABASE_UNAVAILABLE`) rather than buffering queries or hanging the UI.
- The web app displays a clear amber diagnostic alert with exact startup commands instead of hanging on an endless loading screen.
- When MongoDB is started, the Express server automatically connects in the background without needing a manual restart.

---

## Local Network & Mobile API Connectivity

When running the mobile app on a physical device (via Expo Go on the same Wi-Fi) or emulator:

1. **Find your Mac's Local Network IP:**
   ```bash
   ipconfig getifaddr en0
   # Example output: 192.168.137.189
   ```

2. **Update Mobile Environment:**
   In `apps/mobile/.env`:
   ```bash
   EXPO_PUBLIC_API_BASE_URL=http://<YOUR_MAC_LAN_IP>:5001/api
   ```
   *(e.g. `http://192.168.137.189:5001/api`)*

3. **Start Expo with Clean Cache:**
   ```bash
   npm run dev:mobile -- -c
   # or: npx expo start -c --workspace=@predictive-maintenance/mobile
   ```

4. **Network & CORS Configuration:**
   - The Express server binds to `0.0.0.0:5001` (`process.env.HOST || '0.0.0.0'`) so all local network devices can reach it.
   - Development CORS automatically accepts loopback (`localhost`, `127.0.0.1`) and RFC 1918 private IPv4 origins (`10.*`, `192.168.*`, `172.16-31.*`) without exposing production endpoints.

---

## Development Database Seeder & Test Suite

### Seed Local Demo Accounts & Gearbox Assets

Populate development database with Pune Plant #2 (`manager@pune.bharatdynamics.demo`, `tech@pune.bharatdynamics.demo`, `viewer@pune.bharatdynamics.demo`, `GB-104`, `GB-201`) and Chennai Plant #1 (`GB-999` for cross-factory isolation tests):

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
