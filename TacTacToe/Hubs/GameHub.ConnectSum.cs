using System.Security.Claims;
using Microsoft.AspNetCore.SignalR;
using TacTacToe.Models;
using TacTacToe.Services;

namespace TacTacToe.Hubs;

public partial class GameHub
{
    private static readonly string[] ConnectSumBotNames =
    [
        "🔴 Red Bot", "🔵 Blue Bot"
    ];

    // ── Room management ──────────────────────────────────────────────────────

    public async Task CreateConnectSumRoom(string? roomName = null, int connectN = 4)
    {
        var roomId = Guid.NewGuid().ToString("N");
        var room = _lobby.CreateConnectSumRoom(roomId, Context.ConnectionId);
        if (!string.IsNullOrWhiteSpace(roomName))
            room.Settings.RoomName = roomName.Trim()[..Math.Min(roomName.Trim().Length, RoomNameMaxLength)];
        room.Settings.ConnectN = connectN is 4 or 5 or 6 ? connectN : 4;

        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Caller.SendAsync("ConnectSumRoomCreated", roomId);
        await BroadcastConnectSumRooms();
    }

    public async Task GetConnectSumRooms() =>
        await Clients.Caller.SendAsync("ConnectSumRoomList", ConnectSumRoomSummaries());

    public async Task JoinConnectSumRoom(string roomId)
    {
        var room = _lobby.GetConnectSumRoom(roomId);
        if (room == null || room.Started || room.IsOver) return;
        if (room.Players.Count >= room.Settings.MaxPlayers) return;
        if (room.Players.Any(p => p.ConnectionId == Context.ConnectionId)) return;

        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        room.Players.Add(new ConnectSumPlayer { ConnectionId = Context.ConnectionId, Name = name, Connected = true });
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Group(roomId).SendAsync("ConnectSumRoomUpdated", room);
        await BroadcastConnectSumRooms();
    }

    public async Task RejoinConnectSumRoom(string roomId)
    {
        if (string.IsNullOrEmpty(roomId)) return;
        var room = _lobby.GetConnectSumRoom(roomId);
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
            await Clients.Caller.SendAsync("ConnectSumUpdated", BuildConnectSumState(room));
        }
        else
        {
            await Clients.Group(roomId).SendAsync("ConnectSumRoomUpdated", room);
        }
    }

    public async Task StartConnectSumGame(string roomId)
    {
        var room = _lobby.GetConnectSumRoom(roomId);
        if (room == null || room.Started) return;
        if (Context.ConnectionId != room.HostConnectionId) return;
        if (room.Players.Count < 2) return;

        ConnectSumEngine.StartGame(room);
        room.Started = true;

        foreach (var p in room.Players.Where(x => !x.IsBot))
            _lobby.SetInGame(p.ConnectionId, true);

        await BroadcastLobby();
        await Clients.Group(roomId).SendAsync("ConnectSumGameStarted", room.Id);
        await BroadcastConnectSumState(room);
        await BroadcastConnectSumRooms();

        if (room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeConnectSumBotTurnAsync(room.Id);
    }

    public async Task StartConnectSumSinglePlayer(int connectN = 4, string difficulty = "regular")
    {
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var roomId = Guid.NewGuid().ToString("N");
        int n = connectN is 4 or 5 or 6 ? connectN : 4;

        var botName = ConnectSumBotNames[0];
        var room = new ConnectSumRoom
        {
            Id = roomId,
            HostConnectionId = Context.ConnectionId,
            HostName = name,
            IsSinglePlayer = true,
            Settings = new ConnectSumSettings { RoomName = $"Connect {n} vs Bot", MaxPlayers = 2, ConnectN = n },
            Players =
            [
                new ConnectSumPlayer { ConnectionId = Context.ConnectionId, Name = name, Connected = true },
                new ConnectSumPlayer { ConnectionId = $"BOT_{roomId}_0", Name = botName, IsBot = true, Connected = true, AiDifficulty = difficulty }
            ]
        };

        ConnectSumEngine.StartGame(room);
        _lobby.StoreConnectSumRoom(roomId, room);
        _lobby.SetInGame(Context.ConnectionId, true);

        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await BroadcastLobby();
        await Clients.Caller.SendAsync("ConnectSumSinglePlayerStarted", roomId);
        await Clients.Caller.SendAsync("ConnectSumUpdated", BuildConnectSumState(room));

        if (room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeConnectSumBotTurnAsync(room.Id);
    }

    // ── Gameplay ─────────────────────────────────────────────────────────────

    public async Task ConnectSumDropDisc(string roomId, int col)
    {
        var room = _lobby.GetConnectSumRoom(roomId);
        if (room == null || !room.Started || room.IsOver) return;

        var current = room.Players[room.CurrentPlayerIndex];
        if (current.ConnectionId != Context.ConnectionId || current.IsBot) return;

        int row = ConnectSumEngine.DropDisc(room, col);
        if (row < 0) return;

        int player = room.CurrentPlayerIndex + 1;
        if (ConnectSumEngine.CheckWin(room, row, col, player))
        {
            room.IsOver = true;
            room.WinnerName = current.Name;
        }
        else if (ConnectSumEngine.IsBoardFull(room))
        {
            room.IsOver = true;
            room.IsDraw = true;
        }
        else
        {
            room.CurrentPlayerIndex = 1 - room.CurrentPlayerIndex;
        }

        if (room.IsOver) await SaveConnectSumSessionsAsync(room);
        await BroadcastConnectSumState(room);

        if (!room.IsOver && room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeConnectSumBotTurnAsync(room.Id);
    }

    public async Task RequestConnectSumHint(string roomId)
    {
        var room = _lobby.GetConnectSumRoom(roomId);
        if (room == null || !room.Started || room.IsOver) return;

        var me = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId && !p.IsBot);
        if (me == null) return;
        int idx = room.Players.IndexOf(me);

        var hint = ConnectSumEngine.ComputeHint(room, idx);
        await Clients.Caller.SendAsync("ConnectSumHint", hint);
    }

    public async Task LeaveConnectSumRoom(string roomId)
    {
        var room = _lobby.GetConnectSumRoom(roomId);
        if (room == null) return;

        var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);

        if (!room.Started)
        {
            if (player != null) room.Players.Remove(player);
            if (room.Players.Count == 0 || Context.ConnectionId == room.HostConnectionId)
            {
                await Clients.Group(roomId).SendAsync("ConnectSumRoomDissolved");
                _lobby.RemoveConnectSumRoom(roomId);
            }
            else
            {
                await Clients.Group(roomId).SendAsync("ConnectSumRoomUpdated", room);
            }
            await BroadcastConnectSumRooms();
            return;
        }

        if (player == null) return;

        if (room.IsSinglePlayer)
        {
            _lobby.RemoveConnectSumRoom(roomId);
            _lobby.SetInGame(Context.ConnectionId, false);
            await BroadcastLobby();
            return;
        }

        player.Connected = false;
        await Clients.Group(roomId).SendAsync("PlayerLeft", player.Name);

        var connectedHumans = room.Players.Where(p => !p.IsBot && p.Connected).ToList();
        if (connectedHumans.Count == 0)
        {
            _lobby.RemoveConnectSumRoom(roomId);
            await BroadcastConnectSumRooms();
        }
        else
        {
            room.IsOver = true;
            room.WinnerName = connectedHumans[0].Name;
            await BroadcastConnectSumState(room);
            _lobby.SetInGame(connectedHumans[0].ConnectionId, false);
            await BroadcastLobby();
        }
    }

    // ── Bot ───────────────────────────────────────────────────────────────────

    private async Task TakeConnectSumBotTurnAsync(string roomId)
    {
        await Task.Delay(Random.Shared.Next(400, 900));
        var room = _lobby.GetConnectSumRoom(roomId);
        if (room == null || !room.Started || room.IsOver) return;

        var bot = room.Players[room.CurrentPlayerIndex];
        if (!bot.IsBot) return;

        int botIndex = room.CurrentPlayerIndex;
        int col = ConnectSumEngine.BotMove(room, botIndex, bot.AiDifficulty);
        if (col < 0) return;

        int row = ConnectSumEngine.DropDisc(room, col);
        if (row < 0) return;

        int player = botIndex + 1;
        if (ConnectSumEngine.CheckWin(room, row, col, player))
        {
            room.IsOver = true;
            room.WinnerName = bot.Name;
        }
        else if (ConnectSumEngine.IsBoardFull(room))
        {
            room.IsOver = true;
            room.IsDraw = true;
        }
        else
        {
            room.CurrentPlayerIndex = 1 - room.CurrentPlayerIndex;
        }

        if (room.IsOver) await SaveConnectSumSessionsAsync(room);
        await BroadcastConnectSumState(room);

        if (!room.IsOver && room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeConnectSumBotTurnAsync(room.Id);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private async Task BroadcastConnectSumState(ConnectSumRoom room)
    {
        var state = BuildConnectSumState(room);
        await _hubContext.Clients.Group(room.Id).SendAsync("ConnectSumUpdated", state);
    }

    private object BuildConnectSumState(ConnectSumRoom room) => new
    {
        room.Board,
        room.CurrentPlayerIndex,
        room.IsOver,
        room.WinnerName,
        room.WinLine,
        room.IsDraw,
        room.ConnectN,
        room.Rows,
        room.Cols,
        Players = room.Players.Select(p => new { p.Name, p.IsBot, p.Connected }).ToList()
    };

    private async Task BroadcastConnectSumRooms() =>
        await _hubContext.Clients.All.SendAsync("ConnectSumRoomList", ConnectSumRoomSummaries());

    private IEnumerable<object> ConnectSumRoomSummaries() =>
        _lobby.GetOpenConnectSumRooms().Select(r => new
        {
            r.Id,
            r.Settings.RoomName,
            r.HostName,
            PlayerCount = r.Players.Count(p => !p.IsBot),
            MaxPlayers = r.Settings.MaxPlayers,
            IsFull = r.Players.Count(p => !p.IsBot) >= r.Settings.MaxPlayers,
            r.Started,
            r.Settings.ConnectN
        });

    private async Task SaveConnectSumSessionsAsync(ConnectSumRoom room)
    {
        if (room.SessionsSaved) return;
        room.SessionsSaved = true;

        long elapsedSec = (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - room.StartedAtMs) / 1000;
        var tasks = new List<Task>();

        // Count total pieces placed to use as winner score
        int totalPieces = 0;
        for (int r = 0; r < room.Rows; r++)
            for (int c = 0; c < room.Cols; c++)
                if (room.Board[r][c] != 0) totalPieces++;

        foreach (var p in room.Players.Where(x => !x.IsBot))
        {
            var uid = await _users.GetIdByUsernameAsync(p.Name);
            if (uid == null) continue;

            int score = room.IsDraw ? 0 : (room.WinnerName == p.Name ? totalPieces : 0);
            string result = room.IsDraw ? "Draw" : (room.WinnerName == p.Name ? "Win" : "Loss");

            tasks.Add(_sessions.SaveAsync(new GameSession
            {
                UserId = uid.Value,
                GameType = "ConnectSum",
                Score = score,
                Result = result,
                TimePlayed = (int)elapsedSec,
                PlayedAt = DateTime.UtcNow.ToString("o")
            }));
        }

        await Task.WhenAll(tasks);
    }
}
