using System.Collections.Concurrent;
using System.Security.Claims;
using Microsoft.AspNetCore.SignalR;
using TacTacToe.Data;
using TacTacToe.Models;
using TacTacToe.Services;

namespace TacTacToe.Hubs;

public partial class GameHub
{
    // ── Static game-loop registry ─────────────────────────────────────────────

    private static readonly ConcurrentDictionary<string, CancellationTokenSource> _rattlerLoops = new();

    // ── Room management ───────────────────────────────────────────────────────

    public async Task CreateRattlerRoom(string? roomName = null)
    {
        var roomId = Guid.NewGuid().ToString("N");
        var room = _lobby.CreateRattlerRoom(roomId, Context.ConnectionId);
        if (!string.IsNullOrWhiteSpace(roomName))
            room.Settings.RoomName = roomName.Trim()[..Math.Min(roomName.Trim().Length, RoomNameMaxLength)];

        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Caller.SendAsync("RattlerRoomCreated", roomId);
        await BroadcastRattlerRooms();
    }

    public async Task GetRattlerRooms() =>
        await Clients.Caller.SendAsync("RattlerRoomList", RattlerRoomSummaries());

    public async Task JoinRattlerRoom(string roomId)
    {
        var room = _lobby.GetRattlerRoom(roomId);
        if (room == null || room.Started || room.IsOver) return;
        if (room.Players.Count >= room.Settings.MaxPlayers) return;
        if (room.Players.Any(p => p.ConnectionId == Context.ConnectionId)) return;

        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        room.Players.Add(new RattlerPlayer { ConnectionId = Context.ConnectionId, Name = name, Connected = true });
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Group(roomId).SendAsync("RattlerRoomUpdated", room);
        await BroadcastRattlerRooms();
    }

    public async Task RejoinRattlerRoom(string roomId)
    {
        if (string.IsNullOrEmpty(roomId)) return;
        var room = _lobby.GetRattlerRoom(roomId);
        if (room == null) return;

        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var player = room.Players.FirstOrDefault(p => p.Name == name && !p.IsBot);
        if (player == null) return;

        player.ConnectionId = Context.ConnectionId;
        player.Connected = true;
        if (room.HostName == name) room.HostConnectionId = Context.ConnectionId;

        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        if (room.Started)
        {
            _lobby.SetInGame(Context.ConnectionId, true);
            await BroadcastLobby();
            await Clients.Caller.SendAsync("RattlerUpdated", RattlerEngine.BuildStateFor(room, name));
        }
        else
        {
            await Clients.Group(roomId).SendAsync("RattlerRoomUpdated", room);
        }
    }

    public async Task StartRattlerGame(string roomId)
    {
        var room = _lobby.GetRattlerRoom(roomId);
        if (room == null || room.Started) return;
        if (Context.ConnectionId != room.HostConnectionId) return;
        if (room.Players.Count < 2) return;

        RattlerEngine.StartGame(room);
        foreach (var p in room.Players.Where(x => !x.IsBot))
            _lobby.SetInGame(p.ConnectionId, true);

        await BroadcastLobby();
        await Clients.Group(roomId).SendAsync("RattlerGameStarted", room.Id);
        await BroadcastRattlerState(room);
        await BroadcastRattlerRooms();

        StartRattlerLoop(room, _hubContext, _lobby, _sessions);
    }

    public async Task StartRattlerSinglePlayer()
    {
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var roomId = Guid.NewGuid().ToString("N");

        var room = new RattlerRoom
        {
            Id = roomId,
            HostConnectionId = Context.ConnectionId,
            HostName = name,
            IsSinglePlayer = true,
            Settings = new RattlerSettings { RoomName = $"Rattler vs Bot", MaxPlayers = 2 },
            Players =
            [
                new RattlerPlayer { ConnectionId = Context.ConnectionId, Name = name, Connected = true },
                new RattlerPlayer { ConnectionId = $"BOT_{roomId}_0", Name = RattlerEngine.GetBotName(0), IsBot = true, Connected = true }
            ]
        };

        RattlerEngine.StartGame(room);
        _lobby.StoreRattlerRoom(roomId, room);
        _lobby.SetInGame(Context.ConnectionId, true);

        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await BroadcastLobby();
        await Clients.Caller.SendAsync("RattlerSinglePlayerStarted", roomId);
        await Clients.Caller.SendAsync("RattlerUpdated", RattlerEngine.BuildStateFor(room, name));

        StartRattlerLoop(room, _hubContext, _lobby, _sessions);
    }

    // ── Gameplay ──────────────────────────────────────────────────────────────

    public Task RattlerChangeDir(string roomId, int dir)
    {
        var room = _lobby.GetRattlerRoom(roomId);
        if (room == null || !room.Started || room.IsOver) return Task.CompletedTask;

        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var player = room.Players.FirstOrDefault(p => p.Name == name && !p.IsBot);
        if (player == null || player.Dead) return Task.CompletedTask;

        var newDir = (RattlerDir)dir;
        if (!RattlerEngine.IsOpposite(player.Dir, newDir))
            player.NextDir = newDir;

        return Task.CompletedTask;
    }

    public async Task LeaveRattlerRoom(string roomId)
    {
        var room = _lobby.GetRattlerRoom(roomId);
        if (room == null) return;

        var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);

        if (!room.Started)
        {
            if (player != null) room.Players.Remove(player);
            if (room.Players.Count == 0 || Context.ConnectionId == room.HostConnectionId)
            {
                await Clients.Group(roomId).SendAsync("RattlerRoomDissolved");
                _lobby.RemoveRattlerRoom(roomId);
            }
            else
            {
                await Clients.Group(roomId).SendAsync("RattlerRoomUpdated", room);
            }
            await BroadcastRattlerRooms();
            return;
        }

        if (player == null) return;

        if (room.IsSinglePlayer)
        {
            StopRattlerLoop(roomId);
            _lobby.RemoveRattlerRoom(roomId);
            _lobby.SetInGame(Context.ConnectionId, false);
            await BroadcastLobby();
            return;
        }

        player.Dead = true;
        player.Connected = false;
        await Clients.Group(roomId).SendAsync("PlayerLeft", player.Name);

        var connectedHumans = room.Players.Where(p => !p.IsBot && p.Connected).ToList();
        if (connectedHumans.Count == 0)
        {
            StopRattlerLoop(roomId);
            _lobby.RemoveRattlerRoom(roomId);
            await BroadcastRattlerRooms();
            return;
        }

        if (connectedHumans.Count == 1 && !room.IsOver)
        {
            StopRattlerLoop(roomId);
            RattlerEngine.EndGame(room);
            await SaveRattlerSessionsAsync(room);
            await BroadcastRattlerState(room);
            return;
        }
    }

    public async Task LeaveRattlerGame(string roomId) => await LeaveRattlerRoom(roomId);

    public async Task KickRattlerPlayer(string roomId, string playerName)
    {
        var room = _lobby.GetRattlerRoom(roomId);
        if (room == null || Context.ConnectionId != room.HostConnectionId) return;

        var player = room.Players.FirstOrDefault(p => p.Name == playerName && p.ConnectionId != room.HostConnectionId && !p.IsBot);
        if (player == null) return;

        await Clients.Client(player.ConnectionId).SendAsync("KickedFromRoom");
        await Groups.RemoveFromGroupAsync(player.ConnectionId, roomId);
        room.Players.Remove(player);

        await Clients.Group(roomId).SendAsync("RattlerRoomUpdated", room);
        await BroadcastRattlerRooms();
    }

    // ── Game loop ─────────────────────────────────────────────────────────────

    private static void StartRattlerLoop(
        RattlerRoom room,
        IHubContext<GameHub> hubContext,
        LobbyService lobby,
        GameSessionRepository sessions)
    {
        var cts = new CancellationTokenSource();
        _rattlerLoops[room.Id] = cts;

        _ = Task.Run(async () =>
        {
            const int TickMs = 140;
            const int MaxTicks = 1800; // ~4 minutes

            try
            {
                while (!cts.Token.IsCancellationRequested)
                {
                    await Task.Delay(TickMs, cts.Token);

                    var r = lobby.GetRattlerRoom(room.Id);
                    if (r == null || r.IsOver) break;

                    bool ended = RattlerEngine.Tick(r);

                    await BroadcastRattlerStateStatic(r, hubContext);

                    if (ended || r.TickNumber >= MaxTicks)
                    {
                        if (!r.IsOver) RattlerEngine.EndGame(r);
                        await BroadcastRattlerStateStatic(r, hubContext);
                        await SaveRattlerSessionsStaticAsync(r, sessions, lobby);
                        break;
                    }
                }
            }
            catch (OperationCanceledException) { /* expected */ }
            catch (Exception) { /* swallow to avoid crashing the server */ }
            finally
            {
                _rattlerLoops.TryRemove(room.Id, out _);
            }
        }, cts.Token);
    }

    private static void StopRattlerLoop(string roomId)
    {
        if (_rattlerLoops.TryRemove(roomId, out var cts))
            cts.Cancel();
    }

    // ── Broadcast helpers ─────────────────────────────────────────────────────

    private async Task BroadcastRattlerState(RattlerRoom room)
    {
        foreach (var p in room.Players.Where(x => !x.IsBot && x.Connected))
            await Clients.Client(p.ConnectionId).SendAsync("RattlerUpdated", RattlerEngine.BuildStateFor(room, p.Name));
    }

    private static async Task BroadcastRattlerStateStatic(RattlerRoom room, IHubContext<GameHub> hubContext)
    {
        foreach (var p in room.Players.Where(x => !x.IsBot && x.Connected))
            await hubContext.Clients.Client(p.ConnectionId).SendAsync("RattlerUpdated", RattlerEngine.BuildStateFor(room, p.Name));
    }

    private async Task BroadcastRattlerRooms() =>
        await Clients.All.SendAsync("RattlerRoomList", RattlerRoomSummaries());

    private List<RattlerRoomSummary> RattlerRoomSummaries() =>
    [.. _lobby.GetOpenRattlerRooms().Select(r => new RattlerRoomSummary
    {
        Id          = r.Id,
        RoomName    = r.Settings.RoomName,
        HostName    = r.HostName,
        PlayerCount = r.Players.Count,
        MaxPlayers  = r.Settings.MaxPlayers,
        Started     = r.Started,
        IsFull      = r.Players.Count >= r.Settings.MaxPlayers
    })];

    // ── Session persistence ───────────────────────────────────────────────────

    private async Task SaveRattlerSessionsAsync(RattlerRoom room)
    {
        if (room.SessionsSaved) return;
        room.SessionsSaved = true;

        try
        {
            long endMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            int timePlayed = (int)((endMs - room.StartedAtMs) / 1000);
            var now = DateTime.UtcNow.ToString("o");

            foreach (var p in room.Players.Where(x => !x.IsBot))
            {
                _lobby.SetInGame(p.ConnectionId, false);
                var uid = await _users.GetIdByUsernameAsync(p.Name);
                if (!uid.HasValue) continue;

                bool isWinner = p.Name == room.WinnerName;
                await _sessions.SaveAsync(new GameSession
                {
                    UserId     = uid.Value,
                    GameType   = "Rattler",
                    Score      = p.Score,
                    Result     = isWinner ? "Win" : "Loss",
                    TimePlayed = timePlayed,
                    PlayedAt   = now,
                    Details    = $"Players:{room.Players.Count},Ticks:{room.TickNumber}"
                });
            }
        }
        catch { /* non-critical */ }
    }

    private static async Task SaveRattlerSessionsStaticAsync(
        RattlerRoom room,
        GameSessionRepository sessions,
        LobbyService lobby)
    {
        if (room.SessionsSaved) return;
        room.SessionsSaved = true;

        try
        {
            long endMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            int timePlayed = (int)((endMs - room.StartedAtMs) / 1000);
            var now = DateTime.UtcNow.ToString("o");

            foreach (var p in room.Players.Where(x => !x.IsBot))
            {
                // Defer lobby clear regardless of DB success
                lobby.SetInGame(p.ConnectionId, false);

                // We need a UserRepository reference; since we only have sessions here,
                // use the session repo helper that accepts a username query.
                // Fall back: look up via a raw query through sessions' connection.
                var uid = await sessions.GetUserIdByUsernameAsync(p.Name);
                if (!uid.HasValue) continue;

                bool isWinner = p.Name == room.WinnerName;
                await sessions.SaveAsync(new GameSession
                {
                    UserId     = uid.Value,
                    GameType   = "Rattler",
                    Score      = p.Score,
                    Result     = isWinner ? "Win" : "Loss",
                    TimePlayed = timePlayed,
                    PlayedAt   = now,
                    Details    = $"Players:{room.Players.Count},Ticks:{room.TickNumber}"
                });
            }
        }
        catch { /* swallow — session logging is non-critical */ }
    }
}
