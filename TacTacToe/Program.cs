using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using TacTacToe.Data;
using TacTacToe.Hubs;
using TacTacToe.Services;

var builder = WebApplication.CreateBuilder(args);

// SQLite database path — stored outside wwwroot so it is never served as a static file
var dbPath = Path.Combine(builder.Environment.ContentRootPath, "App_Data", "tactactoe.db");

var userRepo    = new UserRepository(dbPath);
var sessionRepo = new GameSessionRepository(dbPath);

builder.Services.AddSingleton(userRepo);
builder.Services.AddSingleton(sessionRepo);
builder.Services.AddSignalR();
builder.Services.AddSingleton<LobbyService>();

builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
.AddCookie(options =>
{
    options.LoginPath = "/login";
    options.Cookie.HttpOnly = true;
    options.Cookie.SameSite = SameSiteMode.Lax;
    options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
    options.ExpireTimeSpan = TimeSpan.FromDays(30);
    options.SlidingExpiration = true;
});

builder.Services.AddAuthorization();

// Write startup errors to Windows Event Log — visible in Event Viewer on IIS
try { builder.Logging.AddEventLog(); } catch { /* Event Log source may not be registered on this server */ }

var app = builder.Build();

// Initialise DB after app is built so the logger is available to capture failures
var startupLogger = app.Services.GetRequiredService<ILogger<Program>>();
try
{
    // Ensure App_Data exists — IIS publish does not create it automatically
    Directory.CreateDirectory(Path.GetDirectoryName(dbPath)!);
    DatabaseInitializer.Initialize(dbPath);
    startupLogger.LogInformation("Database initialised at {Path}", dbPath);
}
catch (Exception ex)
{
    // Log the failure but do NOT re-throw — the process must bind its port so
    // ANCM can forward requests and return a proper 500 rather than a 502.5.
    startupLogger.LogCritical(ex,
        "Failed to initialise database at {Path}. " +
        "Ensure the IIS app-pool identity has Modify rights to that folder.", dbPath);
}

// Ensure browsers always re-validate HTML pages and JS/CSS assets so users
// never see stale content after a deployment without needing a hard refresh.
app.Use(async (ctx, next) =>
{
    ctx.Response.OnStarting(() =>
    {
        if (!ctx.Response.Headers.ContainsKey("Cache-Control"))
        {
            var contentType = ctx.Response.ContentType ?? "";
            if (contentType.StartsWith("text/html"))
                // Never cache HTML — always fetch fresh from server
                ctx.Response.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
            else if (contentType.StartsWith("text/css") || contentType.StartsWith("application/javascript") || contentType.StartsWith("text/javascript"))
                // Revalidate JS/CSS every request; serve from cache if ETag matches (no re-download)
                ctx.Response.Headers["Cache-Control"] = "no-cache, must-revalidate";
        }
        return Task.CompletedTask;
    });
    await next();
});

app.UseStaticFiles();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/", (HttpContext ctx) =>
{
    if (ctx.User.Identity?.IsAuthenticated != true)
        return Results.Redirect("/login");
    return Results.Redirect("/lobby");
});

app.MapGet("/login", () => Results.File("login.html", "text/html"));

app.MapPost("/login", async (HttpContext ctx) =>
{
    var form = await ctx.Request.ReadFormAsync();
    var username = form["name"].ToString().Trim();
    var password = form["password"].ToString();

    // Always use the same generic message to prevent username enumeration
    const string badMsg = "?error=invalid";

    if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(password))
        return Results.Redirect("/login" + badMsg);

    if (username.Length > 20 || password.Length > 128)
        return Results.Redirect("/login" + badMsg);

    var user = await userRepo.VerifyLoginAsync(username, password);
    if (user == null)
        return Results.Redirect("/login" + badMsg);

    // Banned users cannot log in
    if (user.IsBanned)
        return Results.Redirect("/login?error=banned");

    await userRepo.UpdateLastLoginAsync(user.Id);

    var claims = new List<Claim>
    {
        new(ClaimTypes.NameIdentifier, user.Id.ToString()),
        new(ClaimTypes.Name, user.Username),
        new("IsAdmin", user.IsAdmin ? "true" : "false")
    };
    var identity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
    await ctx.SignInAsync(
        CookieAuthenticationDefaults.AuthenticationScheme,
        new ClaimsPrincipal(identity),
        new AuthenticationProperties { IsPersistent = true });

    var returnUrl = form["returnUrl"].ToString();
    if (string.IsNullOrEmpty(returnUrl) || !returnUrl.StartsWith("/"))
        returnUrl = "/lobby";
    return Results.Redirect(returnUrl);
});

app.MapGet("/register", () => Results.File("register.html", "text/html"));

app.MapPost("/register", async (HttpContext ctx) =>
{
    var form = await ctx.Request.ReadFormAsync();
    var username = form["name"].ToString().Trim();
    var password = form["password"].ToString();
    var confirm  = form["confirm"].ToString();

    if (string.IsNullOrEmpty(username) || username.Length < 3 || username.Length > 20)
        return Results.Redirect("/register?error=username");

    if (string.IsNullOrEmpty(password) || password.Length < 8 || password.Length > 128)
        return Results.Redirect("/register?error=password");

    if (password != confirm)
        return Results.Redirect("/register?error=mismatch");

    var id = await userRepo.CreateUserAsync(username, password);
    if (id == null)
        return Results.Redirect("/register?error=taken");

    // Automatically log in after successful registration
    var claims = new List<Claim>
    {
        new(ClaimTypes.NameIdentifier, id.Value.ToString()),
        new(ClaimTypes.Name, username),
        new("IsAdmin", "false")
    };
    var identity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
    await ctx.SignInAsync(
        CookieAuthenticationDefaults.AuthenticationScheme,
        new ClaimsPrincipal(identity),
        new AuthenticationProperties { IsPersistent = true });

    return Results.Redirect("/lobby");
});

app.MapGet("/lobby", (HttpContext ctx) =>
{
    if (ctx.User.Identity?.IsAuthenticated != true)
    {
        var join = ctx.Request.Query["join"].ToString();
        var game = ctx.Request.Query["game"].ToString();
        string lobbyUrl;
        if (string.IsNullOrEmpty(join))
            lobbyUrl = "/lobby";
        else if (string.IsNullOrEmpty(game))
            lobbyUrl = $"/lobby?join={Uri.EscapeDataString(join)}";
        else
            lobbyUrl = $"/lobby?join={Uri.EscapeDataString(join)}&game={Uri.EscapeDataString(game)}";
        return Results.Redirect($"/login?returnUrl={Uri.EscapeDataString(lobbyUrl)}");
    }
    return Results.File("lobby.html", "text/html");
});

app.MapGet("/game", (HttpContext ctx) =>
{
    if (ctx.User.Identity?.IsAuthenticated != true)
        return Results.Redirect("/login");
    return Results.File("game.html", "text/html");
});

app.MapGet("/ttt-room", (HttpContext ctx) =>
{
    if (ctx.User.Identity?.IsAuthenticated != true)
        return Results.Redirect("/login");
    return Results.File("ttt-room.html", "text/html");
});

app.MapGet("/slots", (HttpContext ctx) =>
{
    if (ctx.User.Identity?.IsAuthenticated != true)
        return Results.Redirect("/login");
    return Results.File("slots.html", "text/html");
});

app.MapGet("/slots-room", (HttpContext ctx) =>
{
    if (ctx.User.Identity?.IsAuthenticated != true)
        return Results.Redirect("/login");
    return Results.File("slots-room.html", "text/html");
});

app.MapGet("/yahtzee", (HttpContext ctx) =>
{
    if (ctx.User.Identity?.IsAuthenticated != true)
        return Results.Redirect("/login");
    return Results.File("yahtzee.html", "text/html");
});

app.MapGet("/yahtzee-room", (HttpContext ctx) =>
{
    if (ctx.User.Identity?.IsAuthenticated != true)
        return Results.Redirect("/login");
    return Results.File("yahtzee-room.html", "text/html");
});

app.MapGet("/concentration", (HttpContext ctx) =>
{
    if (ctx.User.Identity?.IsAuthenticated != true)
        return Results.Redirect("/login");
    return Results.File("concentration.html", "text/html");
});

app.MapGet("/concentration-room", (HttpContext ctx) =>
{
    if (ctx.User.Identity?.IsAuthenticated != true)
        return Results.Redirect("/login");
    return Results.File("concentration-room.html", "text/html");
});

app.MapGet("/solitaire", (HttpContext ctx) =>
{
    if (ctx.User.Identity?.IsAuthenticated != true)
        return Results.Redirect("/login");
    return Results.File("solitaire.html", "text/html");
});

app.MapGet("/solitaire-room", (HttpContext ctx) =>
{
    if (ctx.User.Identity?.IsAuthenticated != true)
        return Results.Redirect("/login");
    return Results.File("solitaire-room.html", "text/html");
});

app.MapGet("/peg-solitaire", (HttpContext ctx) =>
{
    if (ctx.User.Identity?.IsAuthenticated != true)
        return Results.Redirect("/login");
    return Results.File("pegsolitaire.html", "text/html");
});

app.MapGet("/peg-solitaire-room", (HttpContext ctx) =>
{
    if (ctx.User.Identity?.IsAuthenticated != true)
        return Results.Redirect("/login");
    return Results.File("pegsolitaire-room.html", "text/html");
});

app.MapGet("/chinese-checkers", (HttpContext ctx) =>
{
    if (ctx.User.Identity?.IsAuthenticated != true)
        return Results.Redirect("/login");
    return Results.File("chinese-checkers.html", "text/html");
});

app.MapGet("/chinese-checkers-room", (HttpContext ctx) =>
{
    if (ctx.User.Identity?.IsAuthenticated != true)
        return Results.Redirect("/login");
    return Results.File("chinese-checkers-room.html", "text/html");
});

app.MapGet("/api/me", async (HttpContext ctx) =>
{
    if (ctx.User.Identity?.IsAuthenticated != true)
        return Results.Unauthorized();
    var name    = ctx.User.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
    var userId  = ctx.User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "";
    var isAdmin = ctx.User.FindFirst("IsAdmin")?.Value == "true";
    string? avatar = null;
    if (int.TryParse(userId, out var uid))
        avatar = await userRepo.GetAvatarAsync(uid);
    return Results.Ok(new { name, userId, isAdmin, avatar });
});

// ── Admin helpers ─────────────────────────────────────────────────────────────
bool IsAdmin(HttpContext ctx) =>
    ctx.User.Identity?.IsAuthenticated == true &&
    ctx.User.FindFirst("IsAdmin")?.Value == "true";

app.MapGet("/admin", (HttpContext ctx) =>
{
    if (!IsAdmin(ctx)) return Results.Redirect("/lobby");
    return Results.File("admin.html", "text/html");
});

// GET all users (admin only)
app.MapGet("/api/admin/users", async (HttpContext ctx) =>
{
    if (!IsAdmin(ctx)) return Results.Forbid();
    var users = await userRepo.GetAllUsersAsync();
    return Results.Ok(users.Select(u => new
    {
        u.Id, u.Username, u.CreatedAt, u.LastLoginAt, u.IsAdmin,
        u.IsBanned, u.BannedAt, u.BanReason
    }));
});

// PATCH promote/demote user
app.MapPatch("/api/admin/users/{id:int}/admin", async (HttpContext ctx, int id) =>
{
    if (!IsAdmin(ctx)) return Results.Forbid();
    var body = await ctx.Request.ReadFromJsonAsync<AdminFlagDto>();
    if (body == null) return Results.BadRequest();
    // Protect: cannot remove admin from own account
    if (int.TryParse(ctx.User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var self) && self == id && !body.IsAdmin)
        return Results.BadRequest(new { error = "Cannot remove your own admin rights." });
    await userRepo.SetAdminAsync(id, body.IsAdmin);
    return Results.Ok();
});

// DELETE user (and all their sessions)
app.MapDelete("/api/admin/users/{id:int}", async (HttpContext ctx, int id) =>
{
    if (!IsAdmin(ctx)) return Results.Forbid();
    if (int.TryParse(ctx.User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var self) && self == id)
        return Results.BadRequest(new { error = "Cannot delete your own account." });
    await userRepo.DeleteUserAsync(id);
    return Results.Ok();
});

// PATCH ban/unban user
app.MapPatch("/api/admin/users/{id:int}/ban", async (HttpContext ctx, int id) =>
{
    if (!IsAdmin(ctx)) return Results.Forbid();
    if (int.TryParse(ctx.User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var selfBan) && selfBan == id)
        return Results.BadRequest(new { error = "Cannot ban yourself." });
    var banBody = await ctx.Request.ReadFromJsonAsync<BanUserDto>();
    if (banBody == null) return Results.BadRequest();
    await userRepo.BanUserAsync(id, banBody.IsBanned, banBody.Reason);
    return Results.Ok();
});

// PATCH reset password
app.MapPatch("/api/admin/users/{id:int}/password", async (HttpContext ctx, int id) =>
{
    if (!IsAdmin(ctx)) return Results.Forbid();
    var body = await ctx.Request.ReadFromJsonAsync<ResetPasswordDto>();
    if (body == null || string.IsNullOrEmpty(body.Password) || body.Password.Length < 8)
        return Results.BadRequest(new { error = "Password must be at least 8 characters." });
    await userRepo.ResetPasswordAsync(id, body.Password);
    return Results.Ok();
});

// GET all sessions (admin view)
app.MapGet("/api/admin/sessions", async (HttpContext ctx) =>
{
    if (!IsAdmin(ctx)) return Results.Forbid();
    var sessions = await sessionRepo.GetAllSessionsAsync();
    return Results.Ok(sessions);
});

// DELETE single session
app.MapDelete("/api/admin/sessions/{id:int}", async (HttpContext ctx, int id) =>
{
    if (!IsAdmin(ctx)) return Results.Forbid();
    await sessionRepo.DeleteSessionAsync(id);
    return Results.Ok();
});

// DELETE all sessions for a user
app.MapDelete("/api/admin/users/{id:int}/sessions", async (HttpContext ctx, int id) =>
{
    if (!IsAdmin(ctx)) return Results.Forbid();
    await sessionRepo.DeleteUserSessionsAsync(id);
    return Results.Ok();
});

// DELETE all sessions for a user by game type
app.MapDelete("/api/admin/users/{id:int}/sessions/{gameType}", async (HttpContext ctx, int id, string gameType) =>
{
    if (!IsAdmin(ctx)) return Results.Forbid();
    await sessionRepo.DeleteSessionsByGameTypeAsync(id, gameType);
    return Results.Ok();
});

// GET platform stats
app.MapGet("/api/admin/stats", async (HttpContext ctx) =>
{
    if (!IsAdmin(ctx)) return Results.Forbid();
    var stats = await sessionRepo.GetPlatformStatsAsync();
    return Results.Ok(stats);
});

app.MapGet("/api/me/history", async (HttpContext ctx, string? game, int limit = 50) =>
{
    if (ctx.User.Identity?.IsAuthenticated != true)
        return Results.Unauthorized();
    if (!int.TryParse(ctx.User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var uid))
        return Results.Unauthorized();
    var history = await sessionRepo.GetUserHistoryAsync(uid, game, limit);
    return Results.Ok(history);
});

app.MapGet("/api/me/stats", async (HttpContext ctx) =>
{
    if (ctx.User.Identity?.IsAuthenticated != true)
        return Results.Unauthorized();
    if (!int.TryParse(ctx.User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var uid))
        return Results.Unauthorized();
    var stats = await sessionRepo.GetUserStatsAsync(uid);
    return Results.Ok(stats);
});

app.MapGet("/api/leaderboard/{gameType}", async (string gameType, int top = 10) =>
{
    var entries = await sessionRepo.GetLeaderboardAsync(gameType, top: top);
    return Results.Ok(entries);
});

// Batch-fetch avatars by username — public (displayed to all players in a room)
app.MapGet("/api/avatars", async (string? names) =>
{
    if (string.IsNullOrWhiteSpace(names))
        return Results.Ok(new Dictionary<string, string?>());
    var list = names
        .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .Where(n => n.Length <= 20)   // usernames are max 20 chars
        .Take(20)                      // cap to prevent large queries
        .ToArray();
    if (list.Length == 0) return Results.Ok(new Dictionary<string, string?>());
    var result = await userRepo.GetAvatarsAsync(list);
    return Results.Ok(result);
});

app.MapGet("/profile", (HttpContext ctx) =>
{
    if (ctx.User.Identity?.IsAuthenticated != true)
        return Results.Redirect("/login");
    return Results.File("profile.html", "text/html");
});

// POST change own password (requires current password)
app.MapPost("/api/me/password", async (HttpContext ctx) =>
{
    if (ctx.User.Identity?.IsAuthenticated != true)
        return Results.Unauthorized();
    if (!int.TryParse(ctx.User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var uid))
        return Results.Unauthorized();
    var body = await ctx.Request.ReadFromJsonAsync<ChangePasswordDto>();
    if (body == null || string.IsNullOrEmpty(body.OldPassword) || string.IsNullOrEmpty(body.NewPassword))
        return Results.BadRequest(new { error = "Missing fields." });
    if (body.NewPassword.Length < 8 || body.NewPassword.Length > 128)
        return Results.BadRequest(new { error = "New password must be 8–128 characters." });
    var ok = await userRepo.ChangePasswordAsync(uid, body.OldPassword, body.NewPassword);
    return ok ? Results.Ok() : Results.BadRequest(new { error = "Current password is incorrect." });
});

// POST update own avatar
app.MapPost("/api/me/avatar", async (HttpContext ctx) =>
{
    if (ctx.User.Identity?.IsAuthenticated != true)
        return Results.Unauthorized();
    if (!int.TryParse(ctx.User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var uid))
        return Results.Unauthorized();
    var body = await ctx.Request.ReadFromJsonAsync<UpdateAvatarDto>();
    if (body == null || string.IsNullOrEmpty(body.Avatar))
        return Results.BadRequest(new { error = "Missing avatar." });
    await userRepo.UpdateAvatarAsync(uid, body.Avatar);
    return Results.Ok();
});

// POST set/update security answer for forgot-password
app.MapPost("/api/me/security-answer", async (HttpContext ctx) =>
{
    if (ctx.User.Identity?.IsAuthenticated != true)
        return Results.Unauthorized();
    if (!int.TryParse(ctx.User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var uid))
        return Results.Unauthorized();
    var body = await ctx.Request.ReadFromJsonAsync<SecurityAnswerDto>();
    if (body == null || string.IsNullOrEmpty(body.Answer) || body.Answer.Trim().Length < 2)
        return Results.BadRequest(new { error = "Answer must be at least 2 characters." });
    await userRepo.UpdateSecurityAnswerAsync(uid, body.Answer);
    return Results.Ok();
});

// GET check whether a username has a security answer set
app.MapGet("/api/forgot-password/check", async (string username) =>
{
    if (string.IsNullOrWhiteSpace(username)) return Results.BadRequest();
    var has = await userRepo.HasSecurityAnswerAsync(username);
    return Results.Ok(new { hasAnswer = has });
});

// POST reset password via security answer
app.MapPost("/api/forgot-password", async (HttpContext ctx) =>
{
    var body = await ctx.Request.ReadFromJsonAsync<ForgotPasswordDto>();
    if (body == null || string.IsNullOrEmpty(body.Username) || string.IsNullOrEmpty(body.Answer) || string.IsNullOrEmpty(body.NewPassword))
        return Results.BadRequest(new { error = "All fields are required." });
    if (body.NewPassword.Length < 8 || body.NewPassword.Length > 128)
        return Results.BadRequest(new { error = "New password must be 8–128 characters." });
    var ok = await userRepo.ResetPasswordBySecurityAnswerAsync(body.Username, body.Answer, body.NewPassword);
    return ok ? Results.Ok() : Results.BadRequest(new { error = "Username or security answer is incorrect." });
});

app.MapGet("/forgot-password", () => Results.File("forgot-password.html", "text/html"));

app.MapPost("/logout", async (HttpContext ctx) =>
{
    await ctx.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    return Results.Redirect("/login");
});

app.MapHub<GameHub>("/gamehub");

app.Run();

record AdminFlagDto(bool IsAdmin);
record ResetPasswordDto(string Password);
record BanUserDto(bool IsBanned, string? Reason);
record ChangePasswordDto(string OldPassword, string NewPassword);
record UpdateAvatarDto(string Avatar);
record SecurityAnswerDto(string Answer);
record ForgotPasswordDto(string Username, string Answer, string NewPassword);
