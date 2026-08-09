---
phase: 260809-wxv
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - API/ZachHairStudio.Api/Mcp/ScheduleTools.cs
  - API/ZachHairStudio.Api/Program.cs
autonomous: true
requirements: [QUICK-260809-wxv]

must_haves:
  truths:
    - "An MCP client can call get_services and get_stylists and receive the active service catalog / active stylists as camelCase JSON."
    - "An MCP client can call get_available_slots with a service name, slug, or numeric id and receive the same SlotService openings the previous availability tool returned — any-stylist union when stylistId is omitted, per-stylist when given."
    - "An unknown or inactive service name fails closed with a structured JSON error payload — the tools never invent or guess a service."
    - "An MCP client can call create_appointment with confirmed customer details and receive the created appointment DTO on success, or a structured error with a kind (validation/not_found/duplicate/system) on failure."
    - "The REST controllers, SlotService, AppointmentsService, and all Shared DTOs are unchanged — this is purely additive in the MCP layer."
  artifacts:
    - "API/ZachHairStudio.Api/Mcp/ScheduleTools.cs — exposes exactly four [McpServerTool] methods: get_services, get_stylists, get_available_slots (ReadOnly), create_appointment (write)"
    - "API/ZachHairStudio.Api/Program.cs — MCP registration unchanged except the surface-comment updated to describe the four tools"
  key_links:
    - "ScheduleTools service resolution -> ServicesService.GetServicesAsync — the name-or-id resolver matches against the real active catalog and fails closed on unknown input; if the resolver drifts from the catalog the tools would return a misleading slot set."
    - "get_available_slots -> SlotService.GetOpenSlotsAsync — the grid math (working hours, time off, booked cells, 15-min grid, salon zone) lives only in SlotService and must NOT be duplicated in the tool."
    - "create_appointment -> AppointmentsService.CreateAsync -> Result<AppointmentResponseDto> — validation, 409-duplicate mapping, D-07 deterministic stylist assignment, and D-11 email all come from the existing service; the tool only maps parameters and serializes the Result."
    - "Program.cs WithTools<ScheduleTools>() -> ScheduleTools — registration is explicit, not assembly-wide discovery; the updated comment must still record why."
---

<objective>
Expose the salon's core booking capabilities as four MCP tools — `get_services`, `get_stylists`, `get_available_slots`, `create_appointment` — by extending the existing MCP server in `ScheduleTools.cs`, reusing SlotService/AppointmentsService/ServicesService/StylistsService without touching the REST layer.

Purpose: The MCP server already exists (260801-irn) with one availability tool. This makes the /mcp surface a complete read-and-book capability so an MCP client can discover the catalog, check openings, and book — all through the same services the REST API uses, so no second availability or booking system is created.

Output: `Mcp/ScheduleTools.cs` extended to four tools (the previous availability tool renamed to `get_available_slots` and given a name-or-id `service` argument), and a `Program.cs` comment brought up to date with the new surface.
</objective>

<execution_context>
@C:/repos/vct/zach-hair-studio/.claude/gsd-core/workflows/execute-plan.md
@C:/repos/vct/zach-hair-studio/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md

@.planning/quick/260801-irn-add-an-mcp-tool-exposing-appointment-slo/260801-irn-PLAN.md
@API/ZachHairStudio.Api/Mcp/ScheduleTools.cs
@API/ZachHairStudio.Api/Program.cs
@API/ZachHairStudio.Shared/Features/Services/ServicesService.cs
@API/ZachHairStudio.Shared/Features/Stylists/StylistsService.cs
@API/ZachHairStudio.Shared/Features/Availability/SlotService.cs
@API/ZachHairStudio.Shared/Features/Appointments/AppointmentsService.cs
@API/ZachHairStudio.Shared/Features/Appointments/AppointmentCreateDto.cs
@API/ZachHairStudio.Shared/Features/Appointments/AppointmentCreateDtoValidator.cs
@API/ZachHairStudio.Shared/Result.cs
</context>

<verified_facts>
Facts established during recon against the actual codebase (260801-irn-PLAN.md + source reads). Do NOT re-derive these — they are load-bearing for the tasks below.

- **MCP server exists and is registered:** `AddMcpServer().WithHttpTransport(options => options.Stateless = true).WithTools<ScheduleTools>()` in Program.cs, mapped at `app.MapMcp("/mcp")`. Stateless mode shares the ASP.NET Core per-request DI scope, which is what resolves scoped services injected as method parameters. No registration changes are needed — all four consumed services are already `AddScoped` (ServicesService, StylistsService, SlotService, AppointmentsService).
- **Existing tool class shape:** `ScheduleTools` is a plain `public class` (not static — `WithTools<T>()` forbids static generic args) with static methods returning `Task<string>`, `[McpServerToolType]` on the class, `[McpServerTool(Name=..., ReadOnly=...)]` + `[Description]` on methods, and a private static camelCase `JsonSerializerOptions`. Scoped services arrive as attribute-free method parameters (resolved from the DI scope, excluded from the tool schema). `date` is a string parsed in-method with `DateOnly.TryParseExact("yyyy-MM-dd", InvariantCulture, DateTimeStyles.None)`, returning a camelCase JSON `error` payload on failure.
- **The previous tool is rename-safe:** the availability tool added in 260801-irn appears nowhere outside `Mcp/ScheduleTools.cs` and its own planning docs — no tests, no consumers. It delegates to `SlotService.GetOpenSlotsAsync(serviceId, stylistId, date)` and serializes `{ date, serviceId, stylistId, count, slots }`. Renaming it and extending its service argument is a pure rename, not a behavior fork.
- **Service catalog reads:** `ServicesService.GetServicesAsync(includeInactive: false)` returns active-only `ServiceResponseDto` (Id, Slug, Name, ShortDescription, LongDescription, Category, DurationMinutes, Price, ImageUrl, DisplayOrder) ordered by DisplayOrder. `StylistsService.GetActiveStylistsAsync()` returns active-only `StylistResponseDto` (Id, Slug, Name, DisplayOrder).
- **The booking write path:** `AppointmentsService.CreateAsync(AppointmentCreateDto)` returns `Result<AppointmentResponseDto>`. `AppointmentCreateDto` = ServiceId (int), StylistId (int?, null = Any stylist, D-07), StartsAt (DateTimeOffset), FirstName/LastName (required, <=100), Email (required, <=150), Phone (<=30). The validator (`AppointmentCreateDtoValidator`) enforces future, on-15-min-grid, <=60-day horizon server-side — the tool must NOT re-implement any of it. Result factories map 409-duplicate (`DuplicateRecordError`) and 404 (`NotFoundError`) through the same service both protocols share.
- **Anonymous-write parity (verified):** `AppointmentsController` carries NO `[Authorize]` — only `[HttpPost]` (line 37). REST `POST /api/appointments` is already anonymous, so `create_appointment` on the unauthenticated `/mcp` grants no capability the REST API does not already expose.
- **`Result<T>` introspection:** `IsSuccess`, `Message`, and the kind predicates `IsValidationError()`, `IsNotFound()`, `IsDuplicateRecord()`, `IsSystemError()` — these map cleanly onto a JSON `kind` field for the error payload.
- **startsAt contract:** the booking UI sends the exact ISO-8601 string taken verbatim from an OpenSlot, so `create_appointment` takes `startsAt` as a string parsed with `DateTimeOffset.TryParse` under InvariantCulture and passes the parsed value through.
- **Test suite:** requires `RESEND_API_KEY` user-secret (D-12/D-13) to run. Build is the automated gate; the full suite is optional if the key is configured.
</verified_facts>

<tasks>

<task type="auto">
  <name>Task 1: Extend the read surface — rename to get_available_slots with name-or-id service, add get_services and get_stylists</name>
  <files>API/ZachHairStudio.Api/Mcp/ScheduleTools.cs</files>
  <action>
Work inside `API/ZachHairStudio.Api/Mcp/ScheduleTools.cs`, namespace `ZachHairStudio.Api.Mcp`, keeping the existing class/field shape (plain non-static `[McpServerToolType]` class, static `Task<string>` methods, existing camelCase `SerializerOptions`). Add `using ZachHairStudio.Shared.Features.Services;` and `using ZachHairStudio.Shared.Features.Stylists;` to the existing using block.

Three changes:

1. Rename the availability tool added in 260801-irn: method `GetAppointmentSlots` becomes `GetAvailableSlots`, the `McpServerTool` name becomes `get_available_slots` (keep `ReadOnly = true`), and its `int serviceId` parameter becomes `string service` with a Description stating it accepts a service name, slug, or numeric id and is resolved against the active catalog (use get_services to list them). Resolution goes through a new private static helper `ResolveServiceIdAsync(ServicesService services, string service)` returning a tuple `(int? Id, string? Error)`: if the input parses as an int, that id is used as-is; otherwise fetch `services.GetServicesAsync()` (active-only) and match the input case-insensitively against `Slug` first, then `Name`; on no match return an error string that echoes the rejected input and lists the available service names so the AI can recover. On a resolution error the tool returns the camelCase JSON `{ error = ... }` payload immediately — fail closed, never guess. The rest of the method is unchanged: same `DateOnly.TryParseExact("yyyy-MM-dd", InvariantCulture, DateTimeStyles.None)` date parsing with the same JSON error payload on failure, same `slotService.GetOpenSlotsAsync(resolvedId.Value, stylistId, parsedDate)` delegation, same `{ date, serviceId, stylistId, count, slots }` response shape with the resolved id in `serviceId`. Update the tool Description to mention the name-or-id behavior and that omitting stylistId returns the any-stylist union view.

2. Add `GetServices` — `[McpServerTool(Name = "get_services", ReadOnly = true)]`, `ServicesService servicesService` DI parameter (no attribute), Description: "Lists the salon's active services (id, name, slug, category, duration, price) — call this before booking so you never invent a service." Returns `JsonSerializer.Serialize(new { services = await servicesService.GetServicesAsync() }, SerializerOptions)`.

3. Add `GetStylists` — `[McpServerTool(Name = "get_stylists", ReadOnly = true)]`, `StylistsService stylistsService` DI parameter, Description: "Lists the salon's active stylists (id, name, slug)." Returns `JsonSerializer.Serialize(new { stylists = await stylistsService.GetActiveStylistsAsync() }, SerializerOptions)`.

Do NOT open, edit, or re-shape `SlotService`, `ServicesService`, `StylistsService`, or any Shared DTO — this task only consumes them. The grid math, time zone handling, and active-filter rules all live in the existing services.

Then build: `dotnet build API/ZachHairStudio.slnx`.
  </action>
  <verify>
    <automated>grep -c 'get_available_slots' API/ZachHairStudio.Api/Mcp/ScheduleTools.cs  # expect 1, and: grep -c 'get_appointment_slots' API/ZachHairStudio.Api/Mcp/ScheduleTools.cs  # expect 0, and: grep -v '^\s*//' API/ZachHairStudio.Api/Mcp/ScheduleTools.cs | grep -cE 'get_services|get_stylists'  # expect 2, then: dotnet build API/ZachHairStudio.slnx  # expect exit 0, 0 errors</automated>
  </verify>
  <done>`ScheduleTools.cs` exposes exactly three read-only tools — `get_services`, `get_stylists`, `get_available_slots` — with no occurrence of the old availability-tool name left in the file. `get_available_slots` resolves `service` name-or-id against the active catalog, fails closed on unknown input, and delegates to `SlotService.GetOpenSlotsAsync` with the unchanged response shape. The solution builds with zero errors.</done>
</task>

<task type="auto">
  <name>Task 2: Add the create_appointment write tool</name>
  <files>API/ZachHairStudio.Api/Mcp/ScheduleTools.cs</files>
  <action>
Add a fourth method `CreateAppointment` to `ScheduleTools.cs` with `[McpServerTool(Name = "create_appointment")]` — deliberately NOT `ReadOnly = true`, this is the first write tool on /mcp. The `[Description]` MUST instruct the AI explicitly: call this tool only after the customer has confirmed the service, time, and contact details out loud, and note the customer receives a confirmation email at the provided address. Do not soften or shorten that requirement.

Parameters, in order:

1. `AppointmentsService appointmentsService` — DI parameter, no attribute.
2. `ServicesService servicesService` — DI parameter, no attribute (feeds the same resolver as Task 1).
3. `string service` — Description: name, slug, or numeric id of the service to book (call get_services first).
4. `int? stylistId = null` — Description: optional; omit for Any stylist (the server assigns a concrete free stylist).
5. `string startsAt` — Description: the exact ISO 8601 instant of the slot returned by get_available_slots (e.g. a value like 2026-08-10T14:00:00+07:00), in salon local time.
6. `string firstName`, `string lastName`, `string email`, `string? phone = null` — Description: the customer's confirmed contact details.

Behavior:

- Parse `startsAt` with `DateTimeOffset.TryParse(startsAt, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsedStartsAt)`; on failure return the same camelCase JSON `{ error = ... }` pattern as the date parser, echoing the rejected value and stating ISO 8601 is expected.
- Resolve the service id via the private `ResolveServiceIdAsync` helper from Task 1; on error return its JSON payload immediately.
- Build `AppointmentCreateDto { ServiceId = resolvedId.Value, StylistId = stylistId, StartsAt = parsedStartsAt, FirstName = firstName, LastName = lastName, Email = email, Phone = phone }` and await `appointmentsService.CreateAsync(dto)`. Do NOT pre-validate anything beyond parsing — the validator in `AppointmentCreateDtoValidator` re-enforces future, 15-minute-grid, and 60-day-horizon rules server-side exactly as it does for REST, and `AppointmentsService` owns the deterministic Any-stylist assignment (D-07), the 409-duplicate race handling, and the best-effort confirmation email (D-11). None of that is duplicated here.
- On `result.IsSuccess`, return `JsonSerializer.Serialize(new { success = true, appointment = result.Data }, SerializerOptions)` — the AppointmentResponseDto serializes camelCase via the existing options.
- On failure, return `JsonSerializer.Serialize(new { success = false, kind = ..., message = result.Message }, SerializerOptions)` where `kind` maps `IsValidationError()` to "validation", `IsNotFound()` to "not_found", `IsDuplicateRecord()` to "duplicate", `IsSystemError()` to "system", and anything else to "error" — so the AI can distinguish a bad argument from a slot that was just taken by someone else.

Then build: `dotnet build API/ZachHairStudio.slnx`.
  </action>
  <verify>
    <automated>grep -c 'create_appointment' API/ZachHairStudio.Api/Mcp/ScheduleTools.cs  # expect 1, and: grep -v '^\s*//' API/ZachHairStudio.Api/Mcp/ScheduleTools.cs | grep -cE 'CreateAsync|AppointmentCreateDto'  # expect >= 2, and: grep -c 'ReadOnly = true' API/ZachHairStudio.Api/Mcp/ScheduleTools.cs  # expect 3 (the three read tools), then: dotnet build API/ZachHairStudio.slnx  # expect exit 0, 0 errors</automated>
  </verify>
  <done>`ScheduleTools.cs` exposes a fourth tool `create_appointment` that is not marked ReadOnly, whose Description requires explicit customer confirmation before invocation, and which maps its arguments onto `AppointmentCreateDto`, delegates to `AppointmentsService.CreateAsync`, and serializes the Result as `{ success, appointment }` or `{ success, kind, message }`. The solution builds with zero errors.</done>
</task>

<task type="auto">
  <name>Task 3: Update the Program.cs MCP surface comment and run the final gate</name>
  <files>API/ZachHairStudio.Api/Program.cs</files>
  <action>
Update the comment block above the `AddMcpServer()` registration in `API/ZachHairStudio.Api/Program.cs` (currently: "Stateless HTTP transport shares the ASP.NET Core per-request DI scope... keeps the unauthenticated /mcp surface limited to exactly this one read-only tool (mitigates T-Q04)"). Rewrite it so it reflects reality: stateless transport shares the per-request DI scope (why scoped services resolve per tool call — unchanged rationale, keep it); explicit `WithTools<ScheduleTools>()` not assembly-wide discovery (unchanged rationale, keep it); and the surface now exposes four tools — three read-only (`get_services`, `get_stylists`, `get_available_slots`) plus one write tool (`create_appointment`) whose Description requires explicit customer confirmation before invocation, matching the anonymous-write parity of the REST `POST /api/appointments` endpoint. Change nothing else in Program.cs — no registration statements, no using block changes, no endpoint changes.

Then run the final gate: build the whole solution, and confirm the additive-only constraint with git status scoped to the Shared project and Controllers folder.
  </action>
  <verify>
    <automated>grep -v '^\s*//' API/ZachHairStudio.Api/Program.cs | grep -cE 'AddMcpServer\(\)|WithTools<ScheduleTools>|MapMcp\("/mcp"\)'  # expect 3, then: dotnet build API/ZachHairStudio.slnx  # expect exit 0, 0 errors, then: git status --porcelain -- API/ZachHairStudio.Shared/ API/ZachHairStudio.Api/Controllers/  # expect no lines</automated>
  </verify>
  <done>`Program.cs`'s MCP comment accurately describes the four-tool surface including the write tool and its confirmation requirement, while the registration statements are byte-identical to before. `dotnet build API/ZachHairStudio.slnx` succeeds with zero errors, and `git status --porcelain` shows no changes in the Shared project or Controllers.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| MCP client -> `/mcp` endpoint | Untrusted JSON-RPC tool arguments (`service`, `startsAt`, `stylistId`, contact fields) cross into the API and reach EF Core queries and an insert. |
| `/mcp` write -> `BookingDbContext` | `create_appointment` inserts Appointment + AppointmentSlot rows into the shared salon schema. |
| `/mcp` -> `Resend` | A successful `create_appointment` triggers a confirmation email to a caller-supplied address (D-11, best-effort, after commit). |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-W01 | Tampering | `service` name-or-id argument | medium | mitigate | Resolved through `ServicesService.GetServicesAsync()` (active-only catalog) and fail-closed with a structured JSON error on unknown/inactive input (Task 1 helper) — the AI can never invent or book a service that does not exist. Numeric ids are parameterized through EF Core; no string concatenation reaches SQL. |
| T-W02 | Tampering | `startsAt` string argument | medium | mitigate | Parsed with `DateTimeOffset.TryParse` under `CultureInfo.InvariantCulture` (structured JSON error on failure), then re-validated server-side by `AppointmentCreateDtoValidator` (future, 15-min grid, <=60-day horizon) inside `AppointmentsService.CreateAsync` — the same rules REST enforces; a forged instant fails closed against the server-recomputed open-slot grid. |
| T-W03 | Elevation of Privilege | New write surface on unauthenticated `/mcp` | medium | accept | **Parity, verified against the codebase:** `AppointmentsController` carries no `[Authorize]` — REST `POST /api/appointments` is already anonymous and shares the same `AppointmentsService`. `create_appointment` grants no capability REST does not already expose, and its Description mandates explicit customer confirmation before invocation. If the owner later decides /mcp needs auth, the same policy must cover both surfaces — recorded in the updated Program.cs comment. |
| T-W04 | Information Disclosure | `get_services` / `get_stylists` / `get_available_slots` responses | low | accept | Returns the active catalog and open start times — the exact payloads `GET /api/services`, `GET /api/stylists`, and `GET /api/appointments/slots` already serve anonymously. No client PII, no appointment-holder data. No new exposure created. |
| T-W05 | Spoofing | AI books an appointment without the customer's consent | medium | mitigate | The `create_appointment` `[Description]` hard-requires the AI to obtain explicit customer confirmation of service, time, and contact details before calling (Task 2). The customer receives the confirmation email at their own address (D-11), making a mistaken booking visible and cancellable; the booking carries no fake account identity (guest booking, D-15). |

## Trust-Boundary Note

The write path reuses `AppointmentsService.CreateAsync` verbatim — validation, deterministic Any-stylist assignment (D-07), race handling via the unfiltered `(StylistId, SlotStart)` unique index, and the single-`SaveChangesAsync` atomicity all behave identically to REST. The MCP layer adds no second booking system.
</threat_model>

<verification>
1. Per-task greps (comment-filtered, per the hygiene rule) confirm the tool surface: `get_available_slots` present, the old availability-tool name gone, `get_services`/`get_stylists`/`create_appointment` present, exactly 3 `ReadOnly = true` attributes.
2. `dotnet build API/ZachHairStudio.slnx` — exit 0, zero errors. This is the required gate from the task brief.
3. `git status --porcelain -- API/ZachHairStudio.Shared/ API/ZachHairStudio.Api/Controllers/` — returns nothing, proving the additive-only constraint held.
4. `git status --porcelain -- API/` lists exactly the two planned files (`Mcp/ScheduleTools.cs`, `Program.cs`) and nothing else.

Non-blocking notes for the executor:
- The test suite requires `RESEND_API_KEY` via user-secrets to run (D-12/D-13). Build success is the gate; if the key is configured locally, running the suite is a useful regression signal that the new tool methods did not disturb `WebApplicationFactory` boot.
- End-to-end confirmation with a live MCP client (connect to `http://localhost:5236/mcp`, list the four tools, call `get_services` then `get_available_slots` then `create_appointment` with a confirmed test booking) requires a running API and a configured client, so it is out of scope for the automated gate. Use the `dev` project skill to launch the stack if manual confirmation is wanted — and remember the API needs `RESEND_API_KEY` and `Jwt:SigningKey` user-secrets to boot (D-13).
</verification>

<success_criteria>
- `Mcp/ScheduleTools.cs` exposes exactly four tools: `get_services`, `get_stylists`, `get_available_slots` (all `ReadOnly = true`) and `create_appointment` (write, non-ReadOnly) — the previous availability tool renamed in place, no duplicate availability tool left behind.
- `service` arguments accept a name, slug, or numeric id resolved against the active catalog; unknown input fails closed with a structured JSON error that lists the available services.
- `create_appointment` maps onto `AppointmentCreateDto`, delegates to `AppointmentsService.CreateAsync`, and serializes success as `{ success, appointment }` and failure as `{ success, kind, message }` with kind ∈ {validation, not_found, duplicate, system, error}.
- The `create_appointment` Description explicitly requires customer confirmation before invocation.
- `Program.cs` registration statements are unchanged; its MCP comment describes the four-tool surface accurately.
- `dotnet build API/ZachHairStudio.slnx` succeeds with zero errors.
- `AppointmentsController.cs`, `SlotService.cs`, `AppointmentsService.cs`, and all Shared DTOs have zero working-tree changes.
- Every threat in the register carries a severity and a disposition; T-W01/T-W02/T-W05 mitigations are implemented by the tasks above.
</success_criteria>

<output>
Create `.planning/quick/260809-wxv-add-four-mcp-tools-get-services-get-styl/260809-wxv-SUMMARY.md` when done.
</output>
