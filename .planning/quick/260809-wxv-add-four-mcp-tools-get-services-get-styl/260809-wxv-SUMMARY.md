---
phase: 260809-wxv
plan: 01
type: execute
wave: 1
status: complete
subsystem: mcp
requires:
  - 260801-irn (existing MCP availability tool, renamed in place)
provides:
  - MCP tools get_services, get_stylists, get_available_slots, create_appointment on /mcp
affects:
  - API/ZachHairStudio.Api/Mcp/ScheduleTools.cs
  - API/ZachHairStudio.Api/Program.cs
tech-stack:
  added: []
  patterns:
    - "MCP tools reuse the Shared services (ServicesService, StylistsService, SlotService, AppointmentsService) verbatim — no second availability or booking system."
    - "Name-or-id resolution against the active catalog with fail-closed JSON errors; Result<T> kind predicates mapped to a structured error 'kind' field."
key-files:
  created: []
  modified:
    - API/ZachHairStudio.Api/Mcp/ScheduleTools.cs
    - API/ZachHairStudio.Api/Program.cs
decisions:
  - "stylistId in create_appointment moved to the end of the parameter list (last, before phone) so all optional parameters come after required ones — the plan listed it mid-list, but C# requires optional parameters last (CS1737). The SDK keeps dictionary-bound optional parameters out of the schema's required array, so MCP clients can still omit it."
metrics:
  duration: "~40 min"
  completed: "2026-08-09"
  tasks: 3
  files: 2
requirements:
  - QUICK-260809-wxv
---

# Phase 260809-wxv Plan 01: Four MCP tools — get_services, get_stylists, get_available_slots, create_appointment Summary

Extended the existing MCP server so a single /mcp surface exposes the salon's full
read-and-book capability: the previous availability tool was renamed to
`get_available_slots` and given a name/slug/id `service` argument, `get_services` and
`get_stylists` list the active catalog, and `create_appointment` books through the exact
same `AppointmentsService.CreateAsync` write path the REST API uses — no second booking
system anywhere.

## Task Results

### Task 1: Read surface — get_available_slots rename + name-or-id service, get_services, get_stylists

- Renamed `GetAppointmentSlots` -> `GetAvailableSlots` (tool `get_appointment_slots` -> `get_available_slots`, ReadOnly kept). The `int serviceId` argument became `string service`, resolved by the new private `ResolveServiceIdAsync(ServicesService, string)` helper: numeric ids pass through as-is; otherwise the active-only catalog (Slug, then Name, case-insensitive) is matched; on no match it fails closed with a structured JSON `{ error }` echoing the rejected input and listing available service names so the AI can recover.
- Added `get_services` (ServicesService.GetServicesAsync, active-only) and `get_stylists` (StylistsService.GetActiveStylistsAsync), both `ReadOnly = true`.
- Delegates to `SlotService.GetOpenSlotsAsync(resolvedId.Value, stylistId, parsedDate)` with the unchanged `{ date, serviceId, stylistId, count, slots }` response shape.
- **Commit:** `d7f6223`

### Task 2: create_appointment write tool

- New non-ReadOnly `create_appointment` whose `[Description]` requires explicit customer confirmation of service, time, and contact details before invocation, and notes the confirmation email is sent to the provided address.
- Parses `startsAt` with `DateTimeOffset.TryParse` (InvariantCulture), resolves `service` via `ResolveServiceIdAsync`, maps onto `AppointmentCreateDto`, and awaits `AppointmentsService.CreateAsync`. No validation is duplicated — the `AppointmentCreateDtoValidator` (future, 15-min grid, <=60-day horizon), D-07 deterministic Any-stylist assignment, 409-duplicate race handling, and D-11 best-effort email all stay in the service.
- Success serializes `{ success: true, appointment }`; failure serializes `{ success: false, kind, message }` with `kind` ∈ {validation, not_found, duplicate, system, error}.
- **Commit:** `e9011af`

### Task 3: Program.cs MCP surface comment + final gate

- Rewrote the comment above `AddMcpServer()` to describe the four-tool surface (three read-only plus the write tool with its confirmation requirement), while keeping the stateless per-request DI scope rationale, the explicit `WithTools<ScheduleTools>()` note, and adding the T-W03 anonymous-write parity note. Registration statements are byte-identical.
- **Commit:** `24d2c20`

## Verification

- `dotnet build API/ZachHairStudio.slnx` — Build succeeded, 0 warnings, 0 errors (run after each task).
- Tool surface greps (comment-filtered): `get_available_slots` present (1), `get_appointment_slots` gone (0), `get_services`/`get_stylists` tool definitions present, `create_appointment` present (1), exactly 3 `ReadOnly = true`.
- `git status --porcelain -- API/ZachHairStudio.Shared/ API/ZachHairStudio.Api/Controllers/` — empty, proving the additive-only constraint.
- `git status --porcelain -- API/` lists exactly the two planned files.
- No tracked files deleted across the three commits.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Stale dev-server file lock blocked the build gate**
- **Found during:** Task 1 build gate
- **Issue:** A leftover `ZachHairStudio.Api` dev server (PID 15852, started 2026-08-09 12:13) held a lock on `API/ZachHairStudio.Api/bin/Debug/net10.0/ZachHairStudio.Shared.dll`, failing the copy step (MSB3027) — the C# compile itself had succeeded. The auto-mode permission classifier denied my attempt to stop the process (a workload I did not create), so I surfaced a blocker; the coordinator confirmed the process was stopped externally.
- **Fix:** Re-ran the build after the process was stopped — succeeded with 0 errors.
- **Files modified:** none (environment condition only)
- **Commit:** n/a

**2. [Rule 1 - Bug] `stylistId` parameter order in create_appointment**
- **Found during:** Task 2 implementation
- **Issue:** The plan listed optional `int? stylistId = null` in the middle of the parameter list (after required `service`/`startsAt`); C# requires optional parameters last (CS1737 — compile error). The SDK (Microsoft.Extensions.AI `AIFunctionFactory`) marks dictionary-bound parameters with a default value as optional in the tool schema, so ordering is irrelevant to the MCP client's ability to omit it.
- **Fix:** Moved `stylistId` to the end of the parameter list (final required-position before the optional `phone`), matching the existing tool's trailing-optional pattern.
- **Files modified:** API/ZachHairStudio.Api/Mcp/ScheduleTools.cs
- **Commit:** `e9011af`

## Known Stubs

None — the four tools call real Shared services and are fully wired.

## Threat Flags

None — no new security surface beyond the planned four tools. The write path is the
anonymous-write parity of REST `POST /api/appointments` (T-W03, accepted), and the
create_appointment Description mandates customer confirmation (T-W05 mitigation).

## Self-Check

- [x] `dotnet build API/ZachHairStudio.slnx` succeeds (0 errors) after each task
- [x] Task 1 commit `d7f6223` exists
- [x] Task 2 commit `e9011af` exists
- [x] Task 3 commit `24d2c20` exists
- [x] SUMMARY.md written to `.planning/quick/260809-wxv-add-four-mcp-tools-get-services-get-styl/260809-wxv-SUMMARY.md`
