using System.Security.Claims;
using Microsoft.AspNetCore.SignalR;
using TacTacToe.Models;
using TacTacToe.Services;

namespace TacTacToe.Hubs;

public partial class GameHub
{
    private static readonly string[] MancalaBotNames =
    [
        "🪨 Pebble Pete", "🪨 Stone Cold"
    ];

    // ── Room management ──────────────────────────────────────────────────────

    public async Task CreateMancalaRoom(string? roomName = null)
    {
        var roomId = Guid.NewGuid().ToString("N");
        var room = _lobby.CreateMancalaRoom(roomId, Context.ConnectionId);
        if (!string.IsNullOrWhiteSpace(roomName))
            room.Settings.RoomName = roomName.Trim()[..Math.Min(roomName.Trim().Length, RoomNameMaxLength)];

        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Caller.SendAsync("MancalaRoomCreated", roomId);
        await BroadcastMancalaRooms();
    }

    public async Task GetMancalaRooms() =>
        await Clients.Caller.SendAsync("MancalaRoomList", MancalaRoomSummaries());

    public async Task JoinMancalaRoom(string roomId)
    {
        var room = _lobby.GetMancalaRoom(roomId);
        if (room == null || room.Started || room.IsOver) return;
        if (room.Players.Count >= room.Settings.MaxPlayers) return;
        if (room.Players.Any(p => p.ConnectionId == Context.ConnectionId)) return;

        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        room.Players.Add(new MancalaPlayer { ConnectionId = Context.ConnectionId, Name = name, Connected = true });
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Group(roomId).SendAsync("MancalaRoomUpdated", room);
        await BroadcastMancalaRooms();
    }

    public async Task RejoinMancalaRoom(string roomId)
    {
        if (string.IsNullOrEmpty(roomId)) return;
        var room = _lobby.GetMancalaRoom(roomId);
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
            await Clients.Caller.SendAsync("MancalaUpdated", BuildMancalaState(room));
        }
        else
        {
            await Clients.Group(roomId).SendAsync("MancalaRoomUpdated", room);
        }
    }

    public async Task StartMancalaGame(string roomId)
    {
        var room = _lobby.GetMancalaRoom(roomId);
        if (room == null || room.Started) return;
        if (Context.ConnectionId != room.HostConnectionId) return;
        if (room.Players.Count < 2) return;

        MancalaEngine.StartGame(room);
        room.Started = true;

        foreach (var p in room.Players.Where(x => !x.IsBot))
            _lobby.SetInGame(p.ConnectionId, true);

        await BroadcastLobby();
        await Clients.Group(roomId).SendAsync("MancalaGameStarted", room.Id);
        await BroadcastMancalaState(room);
        await BroadcastMancalaRooms();

        if (room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeMancalaBotTurnAsync(room.Id);
    }

    public async Task StartMancalaSinglePlayer(string difficulty = "regular")
    {
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var roomId = Guid.NewGuid().ToString("N");

        var botName = MancalaBotNames[0];
        var room = new MancalaRoom
        {
            Id = roomId,
            HostConnectionId = Context.ConnectionId,
            HostName = name,
            IsSinglePlayer = true,
            Settings = new MancalaSettings { RoomName = $"Mancala vs Bot", MaxPlayers = 2 },
            Players =
            [
                new MancalaPlayer { ConnectionId = Context.ConnectionId, Name = name, Connected = true },
                new MancalaPlayer { ConnectionId = $"BOT_{roomId}_0", Name = botName, IsBot = true, Connected = true, AiDifficulty = difficulty }
            ]
        };

        MancalaEngine.StartGame(room);
        _lobby.StoreMancalaRoom(roomId, room);
        _lobby.SetInGame(Context.ConnectionId, true);

        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await BroadcastLobby();
        await Clients.Caller.SendAsync("MancalaSinglePlayerStarted", roomId);
        await Clients.Caller.SendAsync("MancalaUpdated", BuildMancalaState(room));

        if (room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeMancalaBotTurnAsync(room.Id);
    }

    // ── Gameplay ─────────────────────────────────────────────────────────────

    public async Task MancalaPickPit(string roomId, int pitIndex)
    {
        var room = _lobby.GetMancalaRoom(roomId);
        if (room == null || !room.Started || room.IsOver) return;

        var current = room.Players[room.CurrentPlayerIndex];
        if (current.ConnectionId != Context.ConnectionId || current.IsBot) return;

        var (extraTurn, captured, landedIndex, valid) = MancalaEngine.MakeMove(room, pitIndex);
        if (!valid) return;

        if (!room.IsOver)
        {
            if (!extraTurn)
                room.CurrentPlayerIndex = 1 - room.CurrentPlayerIndex;
        }

        if (room.IsOver) await SaveMancalaSessionsAsync(room);
        await BroadcastMancalaState(room);

        if (!room.IsOver && room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeMancalaBotTurnAsync(room.Id);
    }

    public async Task RequestMancalaHint(string roomId)
    {
        var room = _lobby.GetMancalaRoom(roomId);
        if (room == null || !room.Started || room.IsOver) return;

        var me = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId && !p.IsBot);
        if (me == null) return;
        int idx = room.Players.IndexOf(me);

        var hint = MancalaEngine.ComputeHint(room, idx);
        await Clients.Caller.SendAsync("MancalaHint", hint);
    }

    public async Task LeaveMancalaRoom(string roomId)
    {
        var room = _lobby.GetMancalaRoom(roomId);
        if (room == null) return;

        var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);

        if (!room.Started)
        {
            if (player != null) room.Players.Remove(player);
            if (room.Players.Count == 0 || Context.ConnectionId == room.HostConnectionId)
            {
                await Clients.Group(roomId).SendAsync("MancalaRoomDissolved");
                _lobby.RemoveMancalaRoom(roomId);
            }
            else
            {
                await Clients.Group(roomId).SendAsync("MancalaRoomUpdated", room);
            }
            await BroadcastMancalaRooms();
            return;
        }

        if (player == null) return;

        if (room.IsSinglePlayer)
        {
            _lobby.RemoveMancalaRoom(roomId);
            _lobby.SetInGame(Context.ConnectionId, false);
            await BroadcastLobby();
            return;
        }

        player.Connected = false;
        await Clients.Group(roomId).SendAsync("PlayerLeft", player.Name);

        var connectedHumans = room.Players.Where(p => !p.IsBot && p.Connected).ToList();
        if (connectedHumans.Count == 0)
        {
            _lobby.RemoveMancalaRoom(roomId);
            await BroadcastMancalaRooms();
        }
        else
        {
            room.IsOver = true;
            room.WinnerName = connectedHumans[0].Name;
            await BroadcastMancalaState(room);
            _lobby.SetInGame(connectedHumans[0].ConnectionId, false);
            await BroadcastLobby();
        }
    }

    // ── Bot ───────────────────────────────────────────────────────────────────

    private async Task TakeMancalaBotTurnAsync(string roomId)
    {
        await Task.Delay(Random.Shared.Next(600, 1200));
        var room = _lobby.GetMancalaRoom(roomId);
        if (room == null || !room.Started || room.IsOver) return;

        var bot = room.Players[room.CurrentPlayerIndex];
        if (!bot.IsBot) return;

        int botIndex = room.CurrentPlayerIndex;
        int pit = MancalaEngine.BotMove(room, botIndex, bot.AiDifficulty);
        if (pit < 0) return;

        var (extraTurn, _, _, valid) = MancalaEngine.MakeMove(room, pit);
        if (!valid) return;

        if (!room.IsOver)
        {
            if (!extraTurn)
                room.CurrentPlayerIndex = 1 - room.CurrentPlayerIndex;
        }

        if (room.IsOver) await SaveMancalaSessionsAsync(room);
        await BroadcastMancalaState(room);

        if (!room.IsOver && room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeMancalaBotTurnAsync(room.Id);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private async Task BroadcastMancalaState(MancalaRoom room)
    {
        var state = BuildMancalaState(room);
        await _hubContext.Clients.Group(room.Id).SendAsync("MancalaUpdated", state);
    }

    private object BuildMancalaState(MancalaRoom room) => new
    {
        room.Board,
        room.CurrentPlayerIndex,
        room.ExtraTurn,
        room.LastPitIndex,
        room.IsOver,
        room.WinnerName,
        Players = room.Players.Select(p => new { p.Name, p.IsBot, p.Connected }).ToList()
    };

    private async Task BroadcastMancalaRooms() =>
        await _hubContext.Clients.All.SendAsync("MancalaRoomList", MancalaRoomSummaries());

    private IEnumerable<object> MancalaRoomSummaries() =>
        _lobby.GetOpenMancalaRooms().Select(r => new
        {
            r.Id,
            r.Settings.RoomName,
            r.HostName,
            PlayerCount = r.Players.Count(p => !p.IsBot),
            MaxPlayers = r.Settings.MaxPlayers,
            IsFull = r.Players.Count(p => !p.IsBot) >= r.Settings.MaxPlayers,
            r.Started
        });

    private async Task SaveMancalaSessionsAsync(MancalaRoom room)
    {
        if (room.SessionsSaved) return;
        room.SessionsSaved = true;

        long elapsedSec = (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - room.StartedAtMs) / 1000;
        var tasks = new List<Task>();

        foreach (var p in room.Players.Where(x => !x.IsBot))
        {
            var uid = await _users.GetIdByUsernameAsync(p.Name);
            if (uid == null) continue;

            int score = p.Name == room.Players[0].Name ? room.Board[MancalaEngine.P1Store] : room.Board[MancalaEngine.P2Store];
            string result = room.WinnerName == null ? "Draw" : (room.WinnerName == p.Name ? "Win" : "Loss");

            tasks.Add(_sessions.SaveAsync(new GameSession
            {
                UserId = uid.Value,
                GameType = "Mancala",
                Score = score,
                Result = result,
                TimePlayed = (int)elapsedSec,
                PlayedAt = DateTime.UtcNow.ToString("o")
            }));
        }

        await Task.WhenAll(tasks);
    }
}
