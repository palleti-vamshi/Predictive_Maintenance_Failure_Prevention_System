# Product Roadmap & Research Specification

**AI-Based Predictive Maintenance and Failure Prevention System for Mechanical Systems**  
*Initial Focus: Industrial Gearbox*

---

## 1. Product Vision

A research-grounded, production-ready predictive maintenance system allowing authorized factory managers and technicians to upload historical gearbox sensor datasets, evaluate machine condition through explainable multi-signal algorithms, acknowledge warnings, and maintain an immutable record of field maintenance actions.

---

## 2. Research & AI Design Principles

1. **Dual Analysis Foundations:** Compare transparent engineering thresholds (ISO 10816 vibration severity baselines) and statistical rolling metrics with unsupervised Isolation Forest models for unlabeled datasets.
2. **Supervised Classification Restraint:** Employ supervised fault classifiers (e.g., gear tooth pitting, bearing race spall) only when rigorous, ground-truth labeled benchmark data is present.
3. **Regime-Aware Baseline Normalization:** Account for operating regimes (rotational speed and torque/load) so routine operational transients do not generate spurious false alarms.
4. **Decoupled Vibration and Thermal Analysis:** Maintain distinct signal processing channels. Thermal degradation must be flagged even if vibration amplitudes remain quiescent.
5. **Honest Diagnosis Terminology:** Strictly differentiate *unusual behavior* (statistical outlier) from a *diagnosed mechanical failure*. Anomaly scores must never claim component destruction without corroborating domain evidence.
6. **Transparent Explainability:** Quantify sensor channel and time-window contributions to alerts. Apply SHAP only where mathematically valid; otherwise state exact contribution attribution methods clearly.
7. **Explicit Uncertainty & Data Sufficiency:** Report sensor sampling density, gap intervals, and missingness metrics separately from anomaly scores. Avoid uncalibrated percentage "health scores" or pseudo "failure probabilities".
8. **Temporal Persistence Filtering:** Distinguish transient measurement spikes (sensor noise) from persistent or accelerating degradation trends over time windows.
9. **Research Benchmark Comparison:** Provide a benchmark evaluation view comparing algorithms against identical datasets, reporting precision, recall, false alarm rate, and detection lead time.
10. **Sensitivity Exploration:** Enable what-if sensitivity analysis demonstrating how alert thresholds respond as sensor channels return toward nominal baselines, labeled explicitly as model sensitivity rather than physical causality.
11. **Clear Simulation Provenance:** Rigorously distinguish synthetic/simulator datasets from real industrial measurements; never present simulation results as verified industrial validation.
12. **Authentic Industrial UI:** Avoid generic administrative dashboards, decorative gauges without physical units, fake live telemetry streams, or pretend chatbot assistants.

---

## 3. Implementation Phases

| Phase | Title | Scope & Deliverables | Status |
| :---: | :--- | :--- | :---: |
| **1** | **Project Foundation & Monorepo** | Monorepo layout, React/Vite web scaffold, React Native/Expo mobile scaffold, Express API with health/liveness probes, shared constants, local storage adapter, and documentation. | Completed |
| **2** | **Design System & Shells** | Industrial UI components, responsive layout shells, navigation, theme, accessible controls, loading/empty/error states. | Completed |
| **3** | **Authentication & Scoped Access** | JWT/session auth, role-based access control (`factory_manager`, `technician`, `viewer`), hierarchical factory/site/machine scoping enforced on backend. | **Current** |
| **4** | **Gearbox Machine & Site Management** | Machine registry, gearbox specifications (gear ratio, bearing models, rated speed/torque), site hierarchy CRUD, operational status. | Planned |
| **5** | **Dataset Ingestion & Validation** | CSV upload pipeline, signal/unit mapping interface, timestamp validation, gap & missing value detection, range checks, provenance tagging. | Planned |
| **6** | **Analysis Engine Foundation** | Reproducible analysis execution, deterministic run records, baseline computation, storage of feature extraction results. | Planned |
| **7** | **Explainable Alerts & Sufficiency** | Multi-signal alert generation, severity classification (Critical, Warning, Info), sensor contribution breakdown, data sufficiency score. | Planned |
| **8** | **Operating Regimes & Decoupled Channels** | Speed/load regime clustering, decoupled thermal vs vibration evaluation pipelines, persistent trend vs spike discrimination. | Planned |
| **9** | **Web Dashboards & Maintenance Notes** | Historical trend charts, alert acknowledgment workflow, technician maintenance logging, exportable audit reports. | Planned |
| **10** | **Mobile Technician Workflows** | Expo mobile app connected to backend: assigned machine view, dataset upload, alert review, field notes submission. | Planned |
| **11** | **Research Comparison & Sensitivity** | Method comparison suite (Thresholds vs Statistical vs Isolation Forest), ROC/PR evaluation, interactive sensitivity explorer. | Planned |
| **12** | **Hardening & Final Verification** | Security audit, accessibility (WCAG) checks, responsive mobile/web review, end-to-end gearbox verification, demo package. | Planned |

