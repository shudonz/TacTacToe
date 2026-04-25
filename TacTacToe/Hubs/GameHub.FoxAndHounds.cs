using System.Security.Claims;
using Microsoft.AspNetCore.SignalR;
using TacTacToe.Models;
using TacTacToe.Services;

namespace TacTacToe.Hubs;

public partial class GameHub
{
    private static readonly string[] FoxAndHoundsBotNames =
    [
        "🦊 Sly Bot", "🐕 Hunter Bot"
    ];

    // ── Room management ──────────────────────────────────────────────────────

    public async Task CreateFoxAndHoundsRoom(string? roomName = null)
    {
        var roomId = Guid.NewGuid().ToString("N");
        var room = _lobby.CreateFoxAndHoundsRoom(roomId, Context.ConnectionId);
        if (!string.IsNullOrWhiteSpace(roomName))
            room.Settings.RoomName = roomName.Trim()[..Math.Min(roomName.Trim().Length, RoomNameMaxLength)];

        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Caller.SendAsync("FoxAndHoundsRoomCreated", roomId);
        await BroadcastFoxAndHoundsRooms();
    }

    public async Task GetFoxAndHoundsRooms() =>
        await Clients.Caller.SendAsync("FoxAndHoundsRoomList", FoxAndHoundsRoomSummaries());

    public async Task JoinFoxAndHoundsRoom(string roomId)
    {
        var room = _lobby.GetFoxAndHoundsRoom(roomId);
        if (room == null || room.Started || room.IsOver) return;
        if (room.Players.Count >= room.Settings.MaxPlayers) return;
        if (room.Players.Any(p => p.ConnectionId == Context.ConnectionId)) return;

        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        room.Players.Add(new FoxAndHoundsPlayer { ConnectionId = Context.ConnectionId, Name = name, Connected = true });
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Group(roomId).SendAsync("FoxAndHoundsRoomUpdated", room);
        await BroadcastFoxAndHoundsRooms();
    }

    public async Task RejoinFoxAndHoundsRoom(string roomId)
    {
        if (string.IsNullOrEmpty(roomId)) return;
        var room = _lobby.GetFoxAndHoundsRoom(roomId);
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
            await Clients.Caller.SendAsync("FoxAndHoundsUpdated", BuildFoxAndHoundsState(room));
        }
        else
        {
            await Clients.Group(roomId).SendAsync("FoxAndHoundsRoomUpdated", room);
        }
    }

    public async Task StartFoxAndHoundsGame(string roomId, bool fillWithBots = false)
    {
        var room = _lobby.GetFoxAndHoundsRoom(roomId);
        if (room == null || room.Started) return;
        if (Context.ConnectionId != room.HostConnectionId) return;

        if (fillWithBots && room.Players.Count < 2)
        {
            string botName = FoxAndHoundsBotNames[1]; // "Hunter Bot" as default hounds bot
            room.Players.Add(new FoxAndHoundsPlayer
            {
                ConnectionId = $"BOT_{roomId}_0",
                Name = botName,
                IsBot = true,
                Connected = true
            });
        }

        if (room.Players.Count < 2) return;

        FoxAndHoundsEngine.StartGame(room);
        room.Started = true;

        await Clients.Group(roomId).SendAsync("FoxAndHoundsGameStarted", room);
        await Clients.Group(roomId).SendAsync("FoxAndHoundsUpdated", BuildFoxAndHoundsState(room));
        await BroadcastFoxAndHoundsRooms();

        if (room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeFoxAndHoundsBotTurnAsync(roomId);
    }

    public async Task StartFoxAndHoundsSinglePlayer()
    {
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var roomId = Guid.NewGuid().ToString("N");

        var botName = FoxAndHoundsBotNames[1];
        var room = new FoxAndHoundsRoom
        {
            Id = roomId,
            HostConnectionId = Context.ConnectionId,
            HostName = name,
            IsSinglePlayer = true,
            Started = true,
            Settings = new FoxAndHoundsSettings
            {
                RoomName = "Fox and Hounds vs Bot",
                MaxPlayers = 2,
                FillWithBotsOnStart = true
            },
            Players = [
                new FoxAndHoundsPlayer { ConnectionId = Context.ConnectionId, Name = name, Connected = true },
                new FoxAndHoundsPlayer { ConnectionId = $"BOT_{roomId}_0", Name = botName, IsBot = true, Connected = true }
            ]
        };

        FoxAndHoundsEngine.StartGame(room);

        _lobby.StoreFoxAndHoundsRoom(roomId, room);
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Caller.SendAsync("FoxAndHoundsSinglePlayerStarted", roomId);
        await Clients.Caller.SendAsync("FoxAndHoundsUpdated", BuildFoxAndHoundsState(room));

        if (room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeFoxAndHoundsBotTurnAsync(roomId);
    }

    public async Task FoxAndHoundsMove(string roomId, int fromRow, int fromCol, int toRow, int toCol, int houndIndex)
    {
        var room = _lobby.GetFoxAndHoundsRoom(roomId);
        if (room == null || !room.Started || room.IsOver) return;

        var current = room.Players[room.CurrentPlayerIndex];
        if (current.ConnectionId != Context.ConnectionId || current.IsBot) return;

        var move = new FoxAndHoundsMove
        {
            Role       = current.Role,
            FromRow    = fromRow,
            FromCol    = fromCol,
            ToRow      = toRow,
            ToCol      = toCol,
            HoundIndex = houndIndex
        };

        if (!FoxAndHoundsEngine.TryMove(room, move)) return;

        FoxAndHoundsEngine.EvaluateWinner(room);

        if (room.IsOver)
        {
            var winnerPlayer = room.Players.FirstOrDefault(p => p.Role == room.WinnerRole);
            room.WinnerName = winnerPlayer?.Name;
            _ = SaveFoxAndHoundsSessionsAsync(room);
        }
        else
        {
            AdvanceFoxAndHoundsTurn(room);
        }

        await Clients.Group(roomId).SendAsync("FoxAndHoundsUpdated", BuildFoxAndHoundsState(room));

        if (!room.IsOver && room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeFoxAndHoundsBotTurnAsync(roomId);
    }

    public async Task RequestFoxAndHoundsHint(string roomId)
    {
        var room = _lobby.GetFoxAndHoundsRoom(roomId);
        if (room == null || !room.Started || room.IsOver) return;

        var me = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId && !p.IsBot);
        if (me == null) return;

        var hint = FoxAndHoundsEngine.ComputeHint(room, me.Role);
        await Clients.Caller.SendAsync("FoxAndHoundsHint", hint);
    }

    public async Task LeaveFoxAndHoundsRoom(string roomId)
    {
        var room = _lobby.GetFoxAndHoundsRoom(roomId);
        if (room == null) return;

        var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);

        if (!room.Started)
        {
            if (player != null) room.Players.Remove(player);
            if (room.Players.Count == 0 || Context.ConnectionId == room.HostConnectionId)
            {
                await Clients.Group(roomId).SendAsync("FoxAndHoundsRoomDissolved");
                _lobby.RemoveFoxAndHoundsRoom(roomId);
            }
            else
            {
                await Clients.Group(roomId).SendAsync("FoxAndHoundsRoomUpdated", room);
            }
            await BroadcastFoxAndHoundsRooms();
            return;
        }

        if (player == null) return;
        if (room.IsSinglePlayer) { _lobby.RemoveFoxAndHoundsRoom(roomId); return; }

        player.Connected = false;
        await Clients.Group(roomId).SendAsync("PlayerLeft", player.Name);

        var connectedHumans = room.Players.Where(p => !p.IsBot && p.Connected).ToList();
        if (connectedHumans.Count == 0) { _lobby.RemoveFoxAndHoundsRoom(roomId); return; }

        if (connectedHumans.Count == 1)
        {
            room.IsOver = true;
            room.WinnerName = connectedHumans[0].Name;
            room.WinnerRole = connectedHumans[0].Role;
            await Clients.Group(roomId).SendAsync("FoxAndHoundsUpdated", BuildFoxAndHoundsState(room));
            _ = SaveFoxAndHoundsSessionsAsync(room);
        }
    }

    public async Task LeaveFoxAndHoundsGame(string roomId) => await LeaveFoxAndHoundsRoom(roomId);

    public async Task KickFoxAndHoundsPlayer(string roomId, string playerName)
    {
        var room = _lobby.GetFoxAndHoundsRoom(roomId);
        if (room == null || Context.ConnectionId != room.HostConnectionId) return;

        var player = room.Players.FirstOrDefault(p => p.Name == playerName && p.ConnectionId != room.HostConnectionId);
        if (player == null) return;

        await Clients.Client(player.ConnectionId).SendAsync("KickedFromRoom");
        await Groups.RemoveFromGroupAsync(player.ConnectionId, roomId);
        room.Players.Remove(player);

        await Clients.Group(roomId).SendAsync("FoxAndHoundsRoomUpdated", room);
        await BroadcastFoxAndHoundsRooms();
    }

    // ── Bot turn ──────────────────────────────────────────────────────────────

    private async Task TakeFoxAndHoundsBotTurnAsync(string roomId)
    {
        await Task.Delay(Random.Shared.Next(700, 1400));

        var room = _lobby.GetFoxAndHoundsRoom(roomId);
        if (room == null || !room.Started || room.IsOver) return;

        var bot = room.Players[room.CurrentPlayerIndex];
        if (!bot.IsBot) return;

        var move = FoxAndHoundsEngine.ChooseBotMove(room, bot.Role);
        if (move == null)
        {
            // Bot has no moves — declare winner (other side)
            room.IsOver = true;
            room.WinnerRole = bot.Role == "Fox" ? "Hounds" : "Fox";
            var wp = room.Players.FirstOrDefault(p => p.Role == room.WinnerRole);
            room.WinnerName = wp?.Name;
            _ = SaveFoxAndHoundsSessionsAsync(room);
            await _hubContext.Clients.Group(roomId).SendAsync("FoxAndHoundsUpdated", BuildFoxAndHoundsState(room));
            return;
        }

        FoxAndHoundsEngine.TryMove(room, move);
        FoxAndHoundsEngine.EvaluateWinner(room);

        if (room.IsOver)
        {
            var wp = room.Players.FirstOrDefault(p => p.Role == room.WinnerRole);
            room.WinnerName = wp?.Name;
            _ = SaveFoxAndHoundsSessionsAsync(room);
        }
        else
        {
            AdvanceFoxAndHoundsTurn(room);
        }

        await _hubContext.Clients.Group(roomId).SendAsync("FoxAndHoundsUpdated", BuildFoxAndHoundsState(room));

        if (!room.IsOver && room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeFoxAndHoundsBotTurnAsync(roomId);
    }

    private static void AdvanceFoxAndHoundsTurn(FoxAndHoundsRoom room)
    {
        // Alternate between Fox player and Hounds player
        room.CurrentPlayerIndex = room.CurrentPlayerIndex == room.FoxPlayerIndex
            ? room.HoundsPlayerIndex
            : room.FoxPlayerIndex;
    }

    // ── State builder ─────────────────────────────────────────────────────────

    private static object BuildFoxAndHoundsState(FoxAndHoundsRoom room)
    {
        var currentPlayer = room.Players[room.CurrentPlayerIndex];
        string currentRole = currentPlayer.Role;

        object legalMoves;
        if (room.IsOver)
        {
            legalMoves = Array.Empty<object>();
        }
        else if (currentRole == "Fox")
        {
            legalMoves = FoxAndHoundsEngine.GetFoxMoves(room)
                .Select(m => new { m.Role, m.FromRow, m.FromCol, m.ToRow, m.ToCol, m.HoundIndex })
                .ToList();
        }
        else
        {
            legalMoves = FoxAndHoundsEngine.GetHoundMoves(room)
                .Select(m => new { m.Role, m.FromRow, m.FromCol, m.ToRow, m.ToCol, m.HoundIndex })
                .ToList();
        }

        return new
        {
            room.Id,
            room.Started,
            room.IsOver,
            room.IsSinglePlayer,
            room.WinnerRole,
            room.WinnerName,
            room.CurrentPlayerIndex,
            room.FoxPlayerIndex,
            room.HoundsPlayerIndex,
            room.FoxRow,
            room.FoxCol,
            room.Hounds,
            room.MoveCount,
            CurrentRole = currentRole,
            Players = room.Players.Select(p => new
            {
                p.Name,
                p.Connected,
                p.IsBot,
                p.Role
            }),
            LegalMoves = legalMoves,
            LastMove = room.LastMove == null ? null : new
            {
                room.LastMove.Role,
                room.LastMove.FromRow,
                room.LastMove.FromCol,
                room.LastMove.ToRow,
                room.LastMove.ToCol,
                room.LastMove.HoundIndex
            }
        };
    }

    // ── Room summaries & broadcast ────────────────────────────────────────────

    private IEnumerable<object> FoxAndHoundsRoomSummaries() =>
        _lobby.GetOpenFoxAndHoundsRooms().Select(r => new
        {
            r.Id,
            r.HostName,
            RoomName = r.Settings.RoomName,
            PlayerCount = r.Players.Count,
            r.Settings.MaxPlayers,
            IsFull = r.Players.Count >= r.Settings.MaxPlayers,
            r.Started
        });

    private async Task BroadcastFoxAndHoundsRooms() =>
        await Clients.All.SendAsync("FoxAndHoundsRoomList", FoxAndHoundsRoomSummaries());

    // ── Session saving ────────────────────────────────────────────────────────

    private async Task SaveFoxAndHoundsSessionsAsync(FoxAndHoundsRoom room)
    {
        try
        {
            var now = DateTime.UtcNow.ToString("o");
            int elapsed = (int)((DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - room.StartedAtMs) / 1000);

            foreach (var p in room.Players.Where(p => !p.IsBot))
            {
                var uid = await _users.GetIdByUsernameAsync(p.Name);
                if (!uid.HasValue) continue;

                bool won = p.Role == room.WinnerRole;
                int score = p.Role == "Fox"
                    ? FoxAndHoundsEngine.ScoreForFox(room)
                    : FoxAndHoundsEngine.ScoreForHounds(room);

                await _sessions.SaveAsync(new GameSession
                {
                    UserId = uid.Value,
                    GameType = "FoxAndHounds",
                    Score = score,
                    Result = won ? "Win" : "Loss",
                    TimePlayed = elapsed,
                    PlayedAt = now,
                    Details = $"Role:{p.Role},Moves:{room.MoveCount}"
                });
            }
        }
        catch { }
    }
}
