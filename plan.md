1.  **Phase 1: Security & Input Validation (Execute Now)**
    *   **Potential Path Traversal in File Upload**: Update `lib/submissions.ts` to sanitize `file.name` by stripping path traversal characters (replacing non-alphanumeric, periods, and hyphens with underscores, or extracting just the basename).
    *   **Insufficient Input Validation in Commands Creation**: Update `lib/commands.ts` to add early validation for inputs like `queueId`, `producer`, `project`, `media`, and `notes` before saving them to Firestore. This fail-fast mechanism complements the bridge's validation.
2.  **Phase 2: Performance Optimizations (Future Phase)**
    *   Fix N+1 Query in Brand Fetching (intake & home)
    *   Convert Sequential Generation Requests to parallel requests (Promise.all)
    *   Convert Sequential File Uploads to parallel uploads (Promise.all)
    *   Optimize O(N) Includes Check in Loop (e.g., using Sets)
3.  **Phase 3: TypeScript / Type Safety (Future Phase)**
    *   Remove `any` types across the codebase (submission data, catch clauses, callback signatures).
4.  **Phase 4: Refactoring & Best Practices (Future Phase)**
    *   Refactor overly long functions and complex components (intake, QueueCard, bridge module).
    *   Deduplicate brand loading logic.
    *   Implement proper structured error logging instead of raw `console.error`.
    *   Implement command dispatch track.
5.  **Phase 5: Testing & Coverage (Future Phase)**
    *   Add missing unit, integration, and component tests across `lib/commands.ts`, `lib/submissions.ts`, `lib/queue.ts`, `AuthProvider`, `QueueCard`, etc.
6.  **Pre-commit steps**
    *   Ensure proper testing, verification, review, and reflection are done before committing.
7.  **Submit**
    *   Submit the code with a descriptive commit message.
