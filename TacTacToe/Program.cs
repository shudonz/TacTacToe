using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using TacTacToe.Hubs;
using TacTacToe.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSignalR();
builder.Services.AddSingleton<LobbyService>();

builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
.AddCookie(options =>
{
    options.LoginPath = "/login";
    options.Cookie.HttpOnly = true;
    options.Cookie.SameSite = SameSiteMode.Lax;
    options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
    options.ExpireTimeSpan = TimeSpan.FromDays(365);
    options.SlidingExpiration = true;
});

builder.Services.AddAuthorization();

var app = builder.Build();

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
    var name = form["name"].ToString().Trim();
    if (string.IsNullOrEmpty(name) || name.Length > 20)
        return Results.Redirect("/login");

    var claims = new List<Claim> { new(ClaimTypes.Name, name) };
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

app.MapGet("/api/me", (HttpContext ctx) =>
{
    if (ctx.User.Identity?.IsAuthenticated != true)
        return Results.Unauthorized();
    var name = ctx.User.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
    return Results.Ok(new { name });
});

app.MapPost("/logout", async (HttpContext ctx) =>
{
    await ctx.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    return Results.Redirect("/login");
});

app.MapHub<GameHub>("/gamehub");

app.Run();
