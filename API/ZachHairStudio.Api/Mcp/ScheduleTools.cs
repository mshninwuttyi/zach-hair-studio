using System.ComponentModel;
using System.Globalization;
using System.Text.Json;
using ModelContextProtocol.Server;
using ZachHairStudio.Shared.Features.Appointments;
using ZachHairStudio.Shared.Features.Availability;
using ZachHairStudio.Shared.Features.Services;
using ZachHairStudio.Shared.Features.Stylists;

namespace ZachHairStudio.Api.Mcp;

// Plain (non-static) class: WithTools<T>() takes a generic type argument, and C#
// forbids static classes there. Members below are still static, matching the SDK's
// reference pattern for [McpServerToolType] tool classes.
[McpServerToolType]
public class ScheduleTools
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    [McpServerTool(Name = "get_available_slots", ReadOnly = true)]
    [Description("Lists open appointment start times for a service on a given date. " +
        "The service argument accepts a name, slug, or numeric id and is resolved against " +
        "the active catalog (call get_services to list them). Omitting the stylist argument " +
        "returns the union of all active stylists' openings.")]
    public static async Task<string> GetAvailableSlots(
        SlotService slotService,
        ServicesService servicesService,
        [Description("The service name, slug, or numeric id to check availability for (call get_services to list active services).")] string service,
        [Description("The date to check, formatted yyyy-MM-dd, interpreted in salon local time.")] string date,
        [Description("Optional stylist id. Omit to return the any-stylist union view.")] int? stylistId = null)
    {
        var (resolvedId, resolveError) = await ResolveServiceIdAsync(servicesService, service);
        if (resolveError is not null)
        {
            return JsonSerializer.Serialize(new { error = resolveError }, SerializerOptions);
        }

        if (!DateOnly.TryParseExact(
                date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsedDate))
        {
            return JsonSerializer.Serialize(
                new { error = $"Invalid date '{date}'. Expected format: yyyy-MM-dd." }, SerializerOptions);
        }

        var slots = await slotService.GetOpenSlotsAsync(resolvedId.Value, stylistId, parsedDate);

        return JsonSerializer.Serialize(
            new
            {
                date = parsedDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                serviceId = resolvedId.Value,
                stylistId,
                count = slots.Count,
                slots,
            },
            SerializerOptions);
    }

    [McpServerTool(Name = "get_services", ReadOnly = true)]
    [Description("Lists the salon's active services (id, name, slug, category, duration, price) — call this before booking so you never invent a service.")]
    public static async Task<string> GetServices(ServicesService servicesService)
    {
        return JsonSerializer.Serialize(new { services = await servicesService.GetServicesAsync() }, SerializerOptions);
    }

    [McpServerTool(Name = "get_stylists", ReadOnly = true)]
    [Description("Lists the salon's active stylists (id, name, slug).")]
    public static async Task<string> GetStylists(StylistsService stylistsService)
    {
        return JsonSerializer.Serialize(new { stylists = await stylistsService.GetActiveStylistsAsync() }, SerializerOptions);
    }

    [McpServerTool(Name = "create_appointment")]
    [Description("Books an appointment. Call this ONLY after the customer has confirmed the " +
        "service, time, and their contact details out loud. The customer receives a " +
        "confirmation email at the provided address.")]
    public static async Task<string> CreateAppointment(
        AppointmentsService appointmentsService,
        ServicesService servicesService,
        [Description("The service name, slug, or numeric id to book (call get_services first).")] string service,
        [Description("The exact ISO 8601 instant of the slot returned by get_available_slots (e.g. a value like 2026-08-10T14:00:00+07:00), in salon local time.")] string startsAt,
        [Description("The customer's confirmed first name.")] string firstName,
        [Description("The customer's confirmed last name.")] string lastName,
        [Description("The customer's confirmed email address.")] string email,
        [Description("Optional stylist id. Omit for Any stylist (the server assigns a concrete free stylist).")] int? stylistId = null,
        [Description("Optional customer phone number.")] string? phone = null)
    {
        if (!DateTimeOffset.TryParse(startsAt, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsedStartsAt))
        {
            return JsonSerializer.Serialize(
                new { error = $"Invalid startsAt '{startsAt}'. Expected an ISO 8601 instant." }, SerializerOptions);
        }

        var (resolvedId, resolveError) = await ResolveServiceIdAsync(servicesService, service);
        if (resolveError is not null)
        {
            return JsonSerializer.Serialize(new { error = resolveError }, SerializerOptions);
        }

        var result = await appointmentsService.CreateAsync(
            new AppointmentCreateDto
            {
                ServiceId = resolvedId.Value,
                StylistId = stylistId,
                StartsAt = parsedStartsAt,
                FirstName = firstName,
                LastName = lastName,
                Email = email,
                Phone = phone,
            });

        if (result.IsSuccess)
        {
            return JsonSerializer.Serialize(new { success = true, appointment = result.Data }, SerializerOptions);
        }

        var kind = result.IsValidationError() ? "validation"
            : result.IsNotFound() ? "not_found"
            : result.IsDuplicateRecord() ? "duplicate"
            : result.IsSystemError() ? "system"
            : "error";

        return JsonSerializer.Serialize(
            new { success = false, kind, message = result.Message }, SerializerOptions);
    }

    // Resolves a service name, slug, or numeric id against the active catalog. Numeric
    // ids are passed through as-is; anything else is matched against the active-only
    // GetServicesAsync() listing (Slug first, then Name, case-insensitive). Unknown input
    // fails closed with a descriptive error — the tools never invent or guess a service.
    private static async Task<(int? Id, string? Error)> ResolveServiceIdAsync(ServicesService services, string service)
    {
        if (int.TryParse(service, NumberStyles.Integer, CultureInfo.InvariantCulture, out var id))
        {
            return (id, null);
        }

        var catalog = (await services.GetServicesAsync()).ToList();
        var match = catalog.FirstOrDefault(s => string.Equals(s.Slug, service, StringComparison.OrdinalIgnoreCase))
            ?? catalog.FirstOrDefault(s => string.Equals(s.Name, service, StringComparison.OrdinalIgnoreCase));

        if (match is not null)
        {
            return (match.Id, null);
        }

        var available = string.Join(", ", catalog.Select(s => s.Name));
        return (null, $"Unknown service '{service}'. Available services: {available}");
    }
}
