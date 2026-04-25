using System.Security.Claims;
using Microsoft.AspNetCore.SignalR;
using TacTacToe.Models;
using TacTacToe.Services;

namespace TacTacToe.Hubs;

public partial class GameHub
{
    private static readonly string[] BonesBotNames =
    [
        "🦴 Dominic", "🦴 Pip Queen", "🦴 Double-Six"
    ];

    // ── Room management ──────────────────────────────────────────────────────

    public async Task CreateBonesRoom(string? roomName = null)
    {
        var roomId = Guid.NewGuid().ToString("N");
        var room = _lobby.CreateBonesRoom(roomId, Context.ConnectionId);
        if (!string.IsNullOrWhiteSpace(roomName))
            room.Settings.RoomName = roomName.Trim()[..Math.Min(roomName.Trim().Length, RoomNameMaxLength)];

        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Caller.SendAsync("BonesRoomCreated", roomId);
        await BroadcastBonesRooms();
    }

    public async Task GetBonesRooms() =>
        await Clients.Caller.SendAsync("BonesRoomList", BonesRoomSummaries());

    public async Task JoinBonesRoom(string roomId)
    {
        var room = _lobby.GetBonesRoom(roomId);
        if (room == null || room.Started || room.IsOver) return;
        if (room.Players.Count >= room.Settings.MaxPlayers) return;
        if (room.Players.Any(p => p.ConnectionId == Context.ConnectionId)) return;

        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        room.Players.Add(new BonesPlayer { ConnectionId = Context.ConnectionId, Name = name, Connected = true });
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Group(roomId).SendAsync("BonesRoomUpdated", room);
        await BroadcastBonesRooms();
    }

    public async Task RejoinBonesRoom(string roomId)
    {
        if (string.IsNullOrEmpty(roomId)) return;
        var room = _lobby.GetBonesRoom(roomId);
        if (room == null) return;

        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var player = room.Players.FirstOrDefault(p => p.Name == name && !p.IsBot);
        if (player == null) return;

        player.ConnectionId = Context.ConnectionId;
        player.Connected = true;
        if (room.HostName == name) room.HostConnectionId = Context.ConnectionId;

        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        if (room.Started && !room.IsOver)
        {
            _lobby.SetInGame(Context.ConnectionId, true);
            await BroadcastLobby();
            await Clients.Caller.SendAsync("BonesUpdated", BuildBonesStateFor(room, name));
        }
        else
        {
            if (room.IsOver)
            {
                room.Started = false;
                room.IsOver = false;
                room.WinnerName = null;
                room.RoundNumber = 0;
                room.CurrentPlayerIndex = 0;
                room.Boneyard = [];
                room.Chain = [];
                room.LeftOpenEnd = -1;
                room.RightOpenEnd = -1;
                room.RoundOver = false;
                room.RoundWinnerName = null;
                room.GameBlocked = false;
                room.SessionsSaved = false;
                room.Players.RemoveAll(p => p.IsBot);
                foreach (var p in room.Players)
                {
                    p.Hand = [];
                    p.TotalScore = 0;
                    p.Passed = false;
                    p.FinishRank = null;
                }
                foreach (var p in room.Players)
                    _lobby.SetInGame(p.ConnectionId, false);
                await BroadcastLobby();
            }
            await Clients.Group(roomId).SendAsync("BonesRoomUpdated", room);
        }
    }

    public async Task StartBonesGame(string roomId, bool fillWithBots = false)
    {
        var room = _lobby.GetBonesRoom(roomId);
        if (room == null || room.Started) return;
        if (Context.ConnectionId != room.HostConnectionId) return;

        if (fillWithBots)
        {
            int needed = Math.Max(0, room.Settings.MaxPlayers - room.Players.Count);
            for (int i = 0; i < needed; i++)
            {
                var baseName = BonesBotNames[i % BonesBotNames.Length];
                var botName = baseName;
                int sfx = 2;
                while (room.Players.Any(p => p.Name == botName))
                    botName = $"{baseName} #{sfx++}";
                room.Players.Add(new BonesPlayer
                {
                    ConnectionId = $"BOT_{roomId}_{i}",
                    Name = botName,
                    IsBot = true,
                    Connected = true
                });
            }
        }

        if (room.Players.Count < 2) return;

        BonesEngine.StartGame(room);

        foreach (var p in room.Players.Where(x => !x.IsBot))
            _lobby.SetInGame(p.ConnectionId, true);

        await BroadcastLobby();
        await Clients.Group(roomId).SendAsync("BonesGameStarted", room.Id);
        await BroadcastBonesState(room);
        await BroadcastBonesRooms();

        if (room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeBonesBotTurnAsync(room.Id);
    }

    public async Task StartBonesSinglePlayer(int botCount = 1)
    {
        botCount = Math.Clamp(botCount, 1, 3);
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var roomId = Guid.NewGuid().ToString("N");

        var room = new BonesRoom
        {
            Id = roomId,
            HostConnectionId = Context.ConnectionId,
            HostName = name,
            IsSinglePlayer = true,
            Settings = new BonesSettings
            {
                RoomName = $"Bones vs {botCount} Bot{(botCount == 1 ? "" : "s")}",
                MaxPlayers = botCount + 1,
                FillWithBotsOnStart = true
            },
            Players = [new BonesPlayer { ConnectionId = Context.ConnectionId, Name = name, Connected = true }]
        };

        for (int i = 0; i < botCount; i++)
        {
            room.Players.Add(new BonesPlayer
            {
                ConnectionId = $"BOT_{roomId}_{i}",
                Name = BonesBotNames[i % BonesBotNames.Length],
                IsBot = true,
                Connected = true
            });
        }

        BonesEngine.StartGame(room);
        _lobby.StoreBonesRoom(roomId, room);
        _lobby.SetInGame(Context.ConnectionId, true);

        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await BroadcastLobby();
        await Clients.Caller.SendAsync("BonesSinglePlayerStarted", roomId);
        await Clients.Caller.SendAsync("BonesUpdated", BuildBonesStateFor(room, name));

        if (room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeBonesBotTurnAsync(room.Id);
    }

    // ── Gameplay ─────────────────────────────────────────────────────────────

    public async Task BonesPlaceTile(string roomId, int tileId, string side)
    {
        var room = _lobby.GetBonesRoom(roomId);
        if (room == null || !room.Started || room.IsOver || room.RoundOver) return;

        var current = room.Players[room.CurrentPlayerIndex];
        if (current.ConnectionId != Context.ConnectionId || current.IsBot) return;

        if (!BonesEngine.PlaceTile(room, room.CurrentPlayerIndex, tileId, side, out _)) return;

        // Check if player emptied hand (round win)
        if (current.Hand.Count == 0)
        {
            bool gameOver = BonesEngine.FinishRound(room, room.CurrentPlayerIndex);
            if (gameOver)
            {
                await SaveBonesSessionsAsync(room);
            }
            await BroadcastBonesState(room);
            return;
        }

        MoveToNextBonesPlayer(room);
        await BroadcastBonesState(room);

        if (!room.IsOver && !room.RoundOver && room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeBonesBotTurnAsync(room.Id);
    }

    public async Task BonesDrawTile(string roomId)
    {
        var room = _lobby.GetBonesRoom(roomId);
        if (room == null || !room.Started || room.IsOver || room.RoundOver) return;

        var current = room.Players[room.CurrentPlayerIndex];
        if (current.ConnectionId != Context.ConnectionId || current.IsBot) return;

        // Only allowed to draw if no playable tile
        if (BonesEngine.HasPlayableTile(room, room.CurrentPlayerIndex)) return;
        if (room.Boneyard.Count == 0) return;

        BonesEngine.DrawFromBoneyard(room, room.CurrentPlayerIndex, out _);
        await BroadcastBonesState(room);
    }

    public async Task BonesPass(string roomId)
    {
        var room = _lobby.GetBonesRoom(roomId);
        if (room == null || !room.Started || room.IsOver || room.RoundOver) return;

        var current = room.Players[room.CurrentPlayerIndex];
        if (current.ConnectionId != Context.ConnectionId || current.IsBot) return;

        // Only allowed to pass if no playable tile and boneyard empty
        if (BonesEngine.HasPlayableTile(room, room.CurrentPlayerIndex)) return;
        if (room.Boneyard.Count > 0) return;

        current.Passed = true;
        // Check if all players are blocked
        bool allPassed = room.Players.All(p => p.Passed || (p.IsBot && !BonesEngine.HasPlayableTile(room, room.Players.IndexOf(p))));
        if (allPassed)
        {
            bool gameOver = BonesEngine.FinishBlockedRound(room);
            if (gameOver) await SaveBonesSessionsAsync(room);
            await BroadcastBonesState(room);
            return;
        }

        MoveToNextBonesPlayer(room);
        await BroadcastBonesState(room);

        if (!room.IsOver && !room.RoundOver && room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeBonesBotTurnAsync(room.Id);
    }

    public async Task BonesNextRound(string roomId)
    {
        var room = _lobby.GetBonesRoom(roomId);
        if (room == null || !room.Started || room.IsOver || !room.RoundOver) return;
        if (Context.ConnectionId != room.HostConnectionId && !room.IsSinglePlayer) return;

        room.RoundNumber++;
        BonesEngine.StartRound(room);
        await BroadcastBonesState(room);

        if (room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeBonesBotTurnAsync(room.Id);
    }

    public async Task RequestBonesHint(string roomId)
    {
        var room = _lobby.GetBonesRoom(roomId);
        if (room == null || !room.Started || room.IsOver) return;

        var me = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId && !p.IsBot);
        if (me == null) return;
        int idx = room.Players.IndexOf(me);

        var hint = BonesEngine.ComputeHint(room, idx);
        await Clients.Caller.SendAsync("BonesHint", hint);
    }

    public async Task LeaveBonesRoom(string roomId)
    {
        var room = _lobby.GetBonesRoom(roomId);
        if (room == null) return;

        var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);

        if (!room.Started)
        {
            if (player != null) room.Players.Remove(player);
            if (room.Players.Count == 0 || Context.ConnectionId == room.HostConnectionId)
            {
                await Clients.Group(roomId).SendAsync("BonesRoomDissolved");
                _lobby.RemoveBonesRoom(roomId);
            }
            else
            {
                await Clients.Group(roomId).SendAsync("BonesRoomUpdated", room);
            }
            await BroadcastBonesRooms();
            return;
        }

        if (player == null) return;

        if (room.IsSinglePlayer)
        {
            _lobby.RemoveBonesRoom(roomId);
            _lobby.SetInGame(Context.ConnectionId, false);
            await BroadcastLobby();
            return;
        }

        player.Connected = false;
        await Clients.Group(roomId).SendAsync("PlayerLeft", player.Name);

        var connectedHumans = room.Players.Where(p => !p.IsBot && p.Connected).ToList();
        if (connectedHumans.Count == 0)
        {
            _lobby.RemoveBonesRoom(roomId);
            await BroadcastBonesRooms();
            return;
        }

        if (connectedHumans.Count == 1 && !room.IsOver)
        {
            room.IsOver = true;
            room.WinnerName = connectedHumans[0].Name;
            await SaveBonesSessionsAsync(room);
            await BroadcastBonesState(room);
            return;
        }

        if (room.Players[room.CurrentPlayerIndex].ConnectionId == Context.ConnectionId)
            MoveToNextBonesPlayer(room);

        await BroadcastBonesState(room);

        if (!room.IsOver && !room.RoundOver && room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeBonesBotTurnAsync(room.Id);
    }

    public async Task LeaveBonesGame(string roomId) => await LeaveBonesRoom(roomId);

    public async Task KickBonesPlayer(string roomId, string playerName)
    {
        var room = _lobby.GetBonesRoom(roomId);
        if (room == null || Context.ConnectionId != room.HostConnectionId) return;

        var player = room.Players.FirstOrDefault(p => p.Name == playerName && p.ConnectionId != room.HostConnectionId);
        if (player == null) return;

        await Clients.Client(player.ConnectionId).SendAsync("KickedFromRoom");
        await Groups.RemoveFromGroupAsync(player.ConnectionId, roomId);
        room.Players.Remove(player);

        await Clients.Group(roomId).SendAsync("BonesRoomUpdated", room);
        await BroadcastBonesRooms();
    }

    // ── Bot turn ─────────────────────────────────────────────────────────────

    private async Task TakeBonesBotTurnAsync(string roomId)
    {
        await Task.Delay(Random.Shared.Next(700, 1400));

        var room = _lobby.GetBonesRoom(roomId);
        if (room == null || !room.Started || room.IsOver || room.RoundOver) return;

        var bot = room.Players[room.CurrentPlayerIndex];
        if (!bot.IsBot) return;

        var (tileId, side) = BonesEngine.BotDecision(room, room.CurrentPlayerIndex);

        if (tileId >= 0)
        {
            BonesEngine.PlaceTile(room, room.CurrentPlayerIndex, tileId, side, out _);

            if (bot.Hand.Count == 0)
            {
                bool gameOver = BonesEngine.FinishRound(room, room.CurrentPlayerIndex);
                if (gameOver) await SaveBonesSessionsAsync(room);
                await BroadcastBonesState(room);

                // Auto-advance round after brief pause for single player
                if (!room.IsOver && room.RoundOver && room.IsSinglePlayer)
                    _ = AutoNextRoundAsync(room.Id);
                return;
            }

            MoveToNextBonesPlayer(room);
        }
        else if (side == "draw")
        {
            BonesEngine.DrawFromBoneyard(room, room.CurrentPlayerIndex, out _);
            // Bot immediately tries again after drawing
            await BroadcastBonesState(room);
            _ = TakeBonesBotTurnAsync(room.Id);
            return;
        }
        else // pass
        {
            bot.Passed = true;
            bool allPassed = room.Players.All(p =>
                p.Passed || (p.IsBot && !BonesEngine.HasPlayableTile(room, room.Players.IndexOf(p))));
            if (allPassed)
            {
                bool gameOver = BonesEngine.FinishBlockedRound(room);
                if (gameOver) await SaveBonesSessionsAsync(room);
                await BroadcastBonesState(room);

                if (!room.IsOver && room.RoundOver && room.IsSinglePlayer)
                    _ = AutoNextRoundAsync(room.Id);
                return;
            }

            MoveToNextBonesPlayer(room);
        }

        await BroadcastBonesState(room);

        if (!room.IsOver && !room.RoundOver && room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeBonesBotTurnAsync(room.Id);
    }

    private async Task AutoNextRoundAsync(string roomId)
    {
        await Task.Delay(2800);
        var room = _lobby.GetBonesRoom(roomId);
        if (room == null || room.IsOver || !room.RoundOver) return;

        room.RoundNumber++;
        BonesEngine.StartRound(room);
        await BroadcastBonesState(room);

        if (room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeBonesBotTurnAsync(room.Id);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private void MoveToNextBonesPlayer(BonesRoom room)
    {
        if (room.IsOver || room.Players.Count == 0) return;
        int tries = 0;
        do
        {
            room.CurrentPlayerIndex = (room.CurrentPlayerIndex + 1) % room.Players.Count;
            tries++;
        }
        while (tries < room.Players.Count &&
               !room.Players[room.CurrentPlayerIndex].IsBot &&
               !room.Players[room.CurrentPlayerIndex].Connected);
    }

    private object BuildBonesStateFor(BonesRoom room, string playerName)
    {
        var me = room.Players.FirstOrDefault(p => p.Name == playerName && !p.IsBot);
        int playerIndex = me == null ? -1 : room.Players.IndexOf(me);
        bool myTurn = !room.IsOver && !room.RoundOver && playerIndex == room.CurrentPlayerIndex;

        var myHand = me?.Hand.Select(t =>
        {
            var (l, h) = BonesEngine.GetPips(t);
            return new { TileId = t, Low = l, High = h, CanPlace = BonesEngine.CanPlace(room, t) };
        }).ToList() ?? [];

        bool canDraw = myTurn && !BonesEngine.HasPlayableTile(room, playerIndex) && room.Boneyard.Count > 0;
        bool canPass = myTurn && !BonesEngine.HasPlayableTile(room, playerIndex) && room.Boneyard.Count == 0;

        return new
        {
            room.Id,
            room.Started,
            room.IsOver,
            room.IsSinglePlayer,
            room.WinnerName,
            room.RoundNumber,
            room.RoundOver,
            room.RoundWinnerName,
            room.GameBlocked,
            room.CurrentPlayerIndex,
            room.LeftOpenEnd,
            room.RightOpenEnd,
            BoneyardCount = room.Boneyard.Count,
            Chain = room.Chain.Select(e => new { e.TileId, e.ShownLeft, e.ShownRight }).ToList(),
            MyHand = myHand,
            MyTurn = myTurn,
            CanDraw = canDraw,
            CanPass = canPass,
            IsHost = room.HostName == playerName,
            Players = room.Players.Select((p, i) => new
            {
                p.Name,
                p.Connected,
                p.IsBot,
                TileCount = p.Hand.Count,
                p.TotalScore,
                p.Passed,
                IsCurrent = i == room.CurrentPlayerIndex
            }),
            Settings = new { room.Settings.TargetScore, room.Settings.MaxPlayers }
        };
    }

    private async Task BroadcastBonesState(BonesRoom room)
    {
        foreach (var p in room.Players.Where(p => !p.IsBot && p.Connected))
            await _hubContext.Clients.Client(p.ConnectionId)
                .SendAsync("BonesUpdated", BuildBonesStateFor(room, p.Name));
    }

    private IEnumerable<object> BonesRoomSummaries() =>
        _lobby.GetOpenBonesRooms().Select(r => new
        {
            r.Id,
            r.HostName,
            RoomName = r.Settings.RoomName,
            PlayerCount = r.Players.Count,
            r.Settings.MaxPlayers,
            IsFull = r.Players.Count >= r.Settings.MaxPlayers,
            r.Started
        });

    private async Task BroadcastBonesRooms() =>
        await Clients.All.SendAsync("BonesRoomList", BonesRoomSummaries());

    private async Task SaveBonesSessionsAsync(BonesRoom room)
    {
        if (room.SessionsSaved) return;
        room.SessionsSaved = true;

        try
        {
            var now = DateTime.UtcNow.ToString("o");
            int elapsed = (int)((DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - room.StartedAtMs) / 1000);

            foreach (var p in room.Players.Where(p => !p.IsBot))
            {
                var uid = await _users.GetIdByUsernameAsync(p.Name);
                if (!uid.HasValue) continue;

                bool isWinner = p.Name == room.WinnerName;
                int score = isWinner
                    ? p.TotalScore + 50
                    : p.TotalScore;

                await _sessions.SaveAsync(new GameSession
                {
                    UserId = uid.Value,
                    GameType = "Bones",
                    Score = score,
                    Result = isWinner ? "Win" : "Loss",
                    TimePlayed = elapsed,
                    PlayedAt = now,
                    Details = $"Rounds:{room.RoundNumber},Players:{room.Players.Count}"
                });
            }
        }
        catch { }
    }
}
