using System.Security.Claims;
using TacTacToe.Models;
using TacTacToe.Services;

namespace TacTacToe.Hubs;

public partial class GameHub
{
    private static readonly string[] ChineseCheckersBotNames =
    [
        "🤖 Red Fox", "🤖 Jade Panda", "🤖 Azure Crane", "🤖 Gold Tiger", "🤖 Violet Dragon", "🤖 Silver Koi"
    ];

    public async Task CreateChineseCheckersRoom(string? roomName = null)
    {
        var roomId = Guid.NewGuid().ToString("N");
        var room = _lobby.CreateChineseCheckersRoom(roomId, Context.ConnectionId);
        if (!string.IsNullOrWhiteSpace(roomName))
            room.Settings.RoomName = roomName.Trim()[..Math.Min(roomName.Trim().Length, RoomNameMaxLength)];

        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Caller.SendAsync("ChineseCheckersRoomCreated", roomId);
        await BroadcastChineseCheckersRooms();
    }

    public async Task GetChineseCheckersRooms() =>
        await Clients.Caller.SendAsync("ChineseCheckersRoomList", ChineseCheckersRoomSummaries());

    public async Task JoinChineseCheckersRoom(string roomId)
    {
        var room = _lobby.GetChineseCheckersRoom(roomId);
        if (room == null || room.Started || room.IsOver) return;
        if (room.Players.Count >= room.Settings.MaxPlayers) return;
        if (room.Players.Any(p => p.ConnectionId == Context.ConnectionId)) return;

        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        room.Players.Add(new ChineseCheckersPlayer { ConnectionId = Context.ConnectionId, Name = name, Connected = true });
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Group(roomId).SendAsync("ChineseCheckersRoomUpdated", room);
        await BroadcastChineseCheckersRooms();
    }

    public async Task RejoinChineseCheckersRoom(string roomId)
    {
        if (string.IsNullOrEmpty(roomId)) return;
        var room = _lobby.GetChineseCheckersRoom(roomId);
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
            await Clients.Caller.SendAsync("ChineseCheckersUpdated", BuildChineseCheckersState(room));
        }
        else
        {
            await Clients.Group(roomId).SendAsync("ChineseCheckersRoomUpdated", room);
        }
    }

    public async Task StartChineseCheckersGame(string roomId, bool fillWithBots = false)
    {
        var room = _lobby.GetChineseCheckersRoom(roomId);
        if (room == null || room.Started) return;
        if (Context.ConnectionId != room.HostConnectionId) return;

        room.Settings.FillWithBotsOnStart = fillWithBots;
        if (fillWithBots)
        {
            int needed = Math.Max(0, room.Settings.MaxPlayers - room.Players.Count);
            int botIdx = 0;
            for (int i = 0; i < needed; i++)
            {
                string botName = ChineseCheckersBotNames[botIdx % ChineseCheckersBotNames.Length];
                room.Players.Add(new ChineseCheckersPlayer
                {
                    ConnectionId = $"BOT_{roomId}_{i}",
                    Name = botName,
                    IsBot = true,
                    Connected = true
                });
                botIdx++;
            }
        }

        if (room.Players.Count < 2) return;

        ChineseCheckersEngine.StartGame(room);

        await Clients.Group(roomId).SendAsync("ChineseCheckersGameStarted", room);
        await Clients.Group(roomId).SendAsync("ChineseCheckersUpdated", BuildChineseCheckersState(room));
        await BroadcastChineseCheckersRooms();

        if (room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeChineseCheckersBotTurnAsync(roomId);
    }

    public async Task StartChineseCheckersSinglePlayer()
    {
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var roomId = Guid.NewGuid().ToString("N");

        var room = new ChineseCheckersRoom
        {
            Id = roomId,
            HostConnectionId = Context.ConnectionId,
            HostName = name,
            IsSinglePlayer = true,
            Started = true,
            Settings = new ChineseCheckersSettings { RoomName = "Chinese Checkers vs 6 Bots", MaxPlayers = 7, FillWithBotsOnStart = true },
            Players = [new ChineseCheckersPlayer { ConnectionId = Context.ConnectionId, Name = name, Connected = true }]
        };

        for (int i = 0; i < 6; i++)
        {
            room.Players.Add(new ChineseCheckersPlayer
            {
                ConnectionId = $"BOT_{roomId}_{i}",
                Name = ChineseCheckersBotNames[i % ChineseCheckersBotNames.Length],
                IsBot = true,
                Connected = true
            });
        }

        ChineseCheckersEngine.StartGame(room);

        _lobby.StoreChineseCheckersRoom(roomId, room);
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Caller.SendAsync("ChineseCheckersSinglePlayerStarted", roomId);
        await Clients.Caller.SendAsync("ChineseCheckersUpdated", BuildChineseCheckersState(room));

        if (room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeChineseCheckersBotTurnAsync(roomId);
    }

    public async Task ChineseCheckersMove(string roomId, string pieceId, string toNodeId)
    {
        var room = _lobby.GetChineseCheckersRoom(roomId);
        if (room == null || !room.Started || room.IsOver) return;

        var current = room.Players[room.CurrentPlayerIndex];
        if (current.ConnectionId != Context.ConnectionId || current.IsBot || current.FinishRank > 0) return;

        if (!ChineseCheckersEngine.TryMove(room, room.CurrentPlayerIndex, pieceId, toNodeId)) return;

        EvaluateChineseCheckersWinner(room);
        if (!room.IsOver)
            MoveToNextChineseCheckersPlayer(room);

        await Clients.Group(roomId).SendAsync("ChineseCheckersUpdated", BuildChineseCheckersState(room));

        if (!room.IsOver && room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeChineseCheckersBotTurnAsync(roomId);
    }

    public async Task RequestChineseCheckersHint(string roomId)
    {
        var room = _lobby.GetChineseCheckersRoom(roomId);
        if (room == null || !room.Started || room.IsOver) return;

        var me = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId && !p.IsBot);
        if (me == null) return;
        int idx = room.Players.IndexOf(me);
        if (idx < 0) return;

        var hint = ChineseCheckersEngine.ComputeHint(room, idx);
        await Clients.Caller.SendAsync("ChineseCheckersHint", hint);
    }

    public async Task LeaveChineseCheckersRoom(string roomId)
    {
        var room = _lobby.GetChineseCheckersRoom(roomId);
        if (room == null) return;

        var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);

        if (!room.Started)
        {
            if (player != null) room.Players.Remove(player);
            if (room.Players.Count == 0 || Context.ConnectionId == room.HostConnectionId)
            {
                await Clients.Group(roomId).SendAsync("ChineseCheckersRoomDissolved");
                _lobby.RemoveChineseCheckersRoom(roomId);
            }
            else
            {
                await Clients.Group(roomId).SendAsync("ChineseCheckersRoomUpdated", room);
            }
            await BroadcastChineseCheckersRooms();
            return;
        }

        if (player == null) return;

        if (room.IsSinglePlayer)
        {
            _lobby.RemoveChineseCheckersRoom(roomId);
            return;
        }

        player.Connected = false;
        await Clients.Group(roomId).SendAsync("PlayerLeft", player.Name);

        var connectedHumans = room.Players.Where(p => !p.IsBot && p.Connected).ToList();
        if (connectedHumans.Count == 0)
        {
            _lobby.RemoveChineseCheckersRoom(roomId);
            return;
        }

        if (room.Players[room.CurrentPlayerIndex].ConnectionId == Context.ConnectionId)
            MoveToNextChineseCheckersPlayer(room);

        await Clients.Group(roomId).SendAsync("ChineseCheckersUpdated", BuildChineseCheckersState(room));

        if (!room.IsOver && room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeChineseCheckersBotTurnAsync(roomId);
    }

    public async Task LeaveChineseCheckersGame(string roomId) => await LeaveChineseCheckersRoom(roomId);

    public async Task KickChineseCheckersPlayer(string roomId, string playerName)
    {
        var room = _lobby.GetChineseCheckersRoom(roomId);
        if (room == null || Context.ConnectionId != room.HostConnectionId) return;

        var player = room.Players.FirstOrDefault(p => p.Name == playerName && p.ConnectionId != room.HostConnectionId);
        if (player == null) return;

        await Clients.Client(player.ConnectionId).SendAsync("KickedFromRoom");
        await Groups.RemoveFromGroupAsync(player.ConnectionId, roomId);
        room.Players.Remove(player);

        await Clients.Group(roomId).SendAsync("ChineseCheckersRoomUpdated", room);
        await BroadcastChineseCheckersRooms();
    }

    private async Task TakeChineseCheckersBotTurnAsync(string roomId)
    {
        await Task.Delay(Random.Shared.Next(550, 1100));

        var room = _lobby.GetChineseCheckersRoom(roomId);
        if (room == null || !room.Started || room.IsOver) return;

        var bot = room.Players[room.CurrentPlayerIndex];
        if (!bot.IsBot || bot.FinishRank > 0) return;

        var move = ChineseCheckersEngine.ChooseBotMove(room, room.CurrentPlayerIndex);
        if (move == null)
        {
            MoveToNextChineseCheckersPlayer(room);
            await _hubContext.Clients.Group(roomId).SendAsync("ChineseCheckersUpdated", BuildChineseCheckersState(room));
            if (!room.IsOver && room.Players[room.CurrentPlayerIndex].IsBot)
                _ = TakeChineseCheckersBotTurnAsync(roomId);
            return;
        }

        ChineseCheckersEngine.TryMove(room, room.CurrentPlayerIndex, move.PieceId, move.ToNodeId);
        EvaluateChineseCheckersWinner(room);

        if (!room.IsOver)
            MoveToNextChineseCheckersPlayer(room);

        await _hubContext.Clients.Group(roomId).SendAsync("ChineseCheckersUpdated", BuildChineseCheckersState(room));

        if (!room.IsOver && room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeChineseCheckersBotTurnAsync(roomId);
    }

    private void MoveToNextChineseCheckersPlayer(ChineseCheckersRoom room)
    {
        if (room.IsOver || room.Players.Count == 0) return;

        int tries = 0;
        do
        {
            room.CurrentPlayerIndex = (room.CurrentPlayerIndex + 1) % room.Players.Count;
            tries++;
        }
        while (tries < room.Players.Count &&
               (room.Players[room.CurrentPlayerIndex].FinishRank > 0 ||
                (!room.Players[room.CurrentPlayerIndex].IsBot && !room.Players[room.CurrentPlayerIndex].Connected)));
    }

    private void EvaluateChineseCheckersWinner(ChineseCheckersRoom room)
    {
        int rank = room.Players.Count(p => p.FinishRank > 0);
        for (int i = 0; i < room.Players.Count; i++)
        {
            var p = room.Players[i];
            if (p.FinishRank > 0) continue;
            if (ChineseCheckersEngine.HasPlayerFinished(room, i))
            {
                rank++;
                p.FinishRank = rank;
            }
        }

        if (room.Players.Any(p => !p.IsBot && p.Connected && p.FinishRank == 0)) return;

        room.IsOver = true;
        var winner = room.Players.OrderBy(p => p.FinishRank == 0 ? int.MaxValue : p.FinishRank).FirstOrDefault();
        room.WinnerName = winner?.Name;
        _ = SaveChineseCheckersSessionsAsync(room);
    }

    private object BuildChineseCheckersState(ChineseCheckersRoom room)
    {
        var legalMoves = room.IsOver ? [] : ChineseCheckersEngine.GetLegalMoves(room, room.CurrentPlayerIndex)
            .Select(m => new { m.PieceId, m.ToNodeId, m.IsJump })
            .ToList();

        return new
        {
            room.Id,
            room.Started,
            room.IsOver,
            room.IsSinglePlayer,
            room.WinnerName,
            room.CurrentPlayerIndex,
            Players = room.Players.Select((p, i) => new
            {
                p.Name,
                p.Connected,
                p.IsBot,
                p.ColorIndex,
                p.FinishRank,
                Score = ChineseCheckersEngine.ScoreForPlayer(room, i)
            }),
            Nodes = ChineseCheckersEngine.Nodes,
            Pieces = room.Pieces,
            LegalMoves = legalMoves
        };
    }

    private IEnumerable<object> ChineseCheckersRoomSummaries() =>
        _lobby.GetOpenChineseCheckersRooms().Select(r => new
        {
            r.Id,
            r.HostName,
            RoomName = r.Settings.RoomName,
            PlayerCount = r.Players.Count,
            r.Settings.MaxPlayers,
            IsFull = r.Players.Count >= r.Settings.MaxPlayers,
            r.Started
        });

    private async Task BroadcastChineseCheckersRooms() =>
        await Clients.All.SendAsync("ChineseCheckersRoomList", ChineseCheckersRoomSummaries());

    private async Task SaveChineseCheckersSessionsAsync(ChineseCheckersRoom room)
    {
        try
        {
            var now = DateTime.UtcNow.ToString("o");
            int elapsed = (int)((DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - room.StartedAtMs) / 1000);

            foreach (var p in room.Players.Where(p => !p.IsBot))
            {
                var uid = await _users.GetIdByUsernameAsync(p.Name);
                if (!uid.HasValue) continue;

                var result = p.Name == room.WinnerName ? "Win" : "Loss";
                var playerIndex = room.Players.IndexOf(p);

                await _sessions.SaveAsync(new GameSession
                {
                    UserId = uid.Value,
                    GameType = "ChineseCheckers",
                    Score = ChineseCheckersEngine.ScoreForPlayer(room, playerIndex),
                    Result = result,
                    TimePlayed = elapsed,
                    PlayedAt = now,
                    Details = $"Rank:{p.FinishRank},Players:{room.Players.Count}"
                });
            }
        }
        catch { }
    }
}
