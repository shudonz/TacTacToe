using System.Security.Claims;
using TacTacToe.Models;
using TacTacToe.Services;

namespace TacTacToe.Hubs;

public partial class GameHub
{
    private static readonly string[] CrazyEightsBotNames =
    [
        "🤖 Midnight Jack", "🤖 Velvet Queen", "🤖 Neon Joker"
    ];

    public async Task CreateCrazyEightsRoom(string? roomName = null)
    {
        var roomId = Guid.NewGuid().ToString("N");
        var room = _lobby.CreateCrazyEightsRoom(roomId, Context.ConnectionId);
        if (!string.IsNullOrWhiteSpace(roomName))
            room.Settings.RoomName = roomName.Trim()[..Math.Min(roomName.Trim().Length, RoomNameMaxLength)];

        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Caller.SendAsync("CrazyEightsRoomCreated", roomId);
        await BroadcastCrazyEightsRooms();
    }

    public async Task GetCrazyEightsRooms() =>
        await Clients.Caller.SendAsync("CrazyEightsRoomList", CrazyEightsRoomSummaries());

    public async Task JoinCrazyEightsRoom(string roomId)
    {
        var room = _lobby.GetCrazyEightsRoom(roomId);
        if (room == null || room.Started || room.IsOver) return;
        if (room.Players.Count >= room.Settings.MaxPlayers) return;
        if (room.Players.Any(p => p.ConnectionId == Context.ConnectionId)) return;

        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        room.Players.Add(new CrazyEightsPlayer { ConnectionId = Context.ConnectionId, Name = name, Connected = true });
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Group(roomId).SendAsync("CrazyEightsRoomUpdated", room);
        await BroadcastCrazyEightsRooms();
    }

    public async Task RejoinCrazyEightsRoom(string roomId)
    {
        if (string.IsNullOrEmpty(roomId)) return;
        var room = _lobby.GetCrazyEightsRoom(roomId);
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
            await Clients.Caller.SendAsync("CrazyEightsUpdated", BuildCrazyEightsStateFor(room, player.Name));
        }
        else
        {
            await Clients.Group(roomId).SendAsync("CrazyEightsRoomUpdated", room);
        }
    }

    public async Task StartCrazyEightsGame(string roomId, bool fillWithBots = false)
    {
        var room = _lobby.GetCrazyEightsRoom(roomId);
        if (room == null || room.Started) return;
        if (Context.ConnectionId != room.HostConnectionId) return;

        room.Settings.FillWithBotsOnStart = fillWithBots;
        if (fillWithBots)
        {
            int needed = Math.Max(0, room.Settings.MaxPlayers - room.Players.Count);
            int botIdx = 0;
            for (int i = 0; i < needed; i++)
            {
                var baseName = CrazyEightsBotNames[botIdx % CrazyEightsBotNames.Length];
                var botName = room.Players.Any(p => p.Name == baseName) ? $"{baseName} #{botIdx + 1}" : baseName;
                room.Players.Add(new CrazyEightsPlayer
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

        CrazyEightsEngine.StartGame(room);

        foreach (var p in room.Players.Where(x => !x.IsBot))
            _lobby.SetInGame(p.ConnectionId, true);

        await BroadcastLobby();
        await Clients.Group(roomId).SendAsync("CrazyEightsGameStarted", room);
        await BroadcastCrazyEightsState(room);
        await BroadcastCrazyEightsRooms();

        if (room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeCrazyEightsBotTurnAsync(room.Id);
    }

    public async Task StartCrazyEightsSinglePlayer(int botCount = 1)
    {
        botCount = Math.Clamp(botCount, 1, 3);
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var roomId = Guid.NewGuid().ToString("N");

        var room = new CrazyEightsRoom
        {
            Id = roomId,
            HostConnectionId = Context.ConnectionId,
            HostName = name,
            IsSinglePlayer = true,
            Started = true,
            Settings = new CrazyEightsSettings
            {
                RoomName = $"Crazy Eights vs {botCount} Bot{(botCount == 1 ? "" : "s")}",
                MaxPlayers = botCount + 1,
                FillWithBotsOnStart = true
            },
            Players = [new CrazyEightsPlayer { ConnectionId = Context.ConnectionId, Name = name, Connected = true }]
        };

        for (int i = 0; i < botCount; i++)
        {
            room.Players.Add(new CrazyEightsPlayer
            {
                ConnectionId = $"BOT_{roomId}_{i}",
                Name = CrazyEightsBotNames[i % CrazyEightsBotNames.Length],
                IsBot = true,
                Connected = true
            });
        }

        CrazyEightsEngine.StartGame(room);

        _lobby.StoreCrazyEightsRoom(roomId, room);
        _lobby.SetInGame(Context.ConnectionId, true);
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await BroadcastLobby();
        await Clients.Caller.SendAsync("CrazyEightsSinglePlayerStarted", roomId);
        await Clients.Caller.SendAsync("CrazyEightsUpdated", BuildCrazyEightsStateFor(room, name));

        if (room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeCrazyEightsBotTurnAsync(room.Id);
    }

    public async Task PlayCrazyEightsCard(string roomId, int cardId, int? chosenSuit = null)
    {
        var room = _lobby.GetCrazyEightsRoom(roomId);
        if (room == null || !room.Started || room.IsOver) return;

        var current = room.Players[room.CurrentPlayerIndex];
        if (current.ConnectionId != Context.ConnectionId || current.IsBot || current.FinishRank > 0) return;

        if (!CrazyEightsEngine.PlayCard(room, room.CurrentPlayerIndex, cardId, chosenSuit, out var won)) return;

        if (won)
        {
            room.IsOver = true;
            room.WinnerName = current.Name;
            await SaveCrazyEightsSessionsAsync(room);
        }
        else
        {
            MoveToNextCrazyEightsPlayer(room);
        }

        await BroadcastCrazyEightsState(room);

        if (!room.IsOver && room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeCrazyEightsBotTurnAsync(room.Id);
    }

    public async Task DrawCrazyEightsCard(string roomId)
    {
        var room = _lobby.GetCrazyEightsRoom(roomId);
        if (room == null || !room.Started || room.IsOver) return;

        var current = room.Players[room.CurrentPlayerIndex];
        if (current.ConnectionId != Context.ConnectionId || current.IsBot || current.FinishRank > 0) return;

        if (CrazyEightsEngine.HasPlayableCard(room, room.CurrentPlayerIndex)) return;

        if (!CrazyEightsEngine.DrawOne(room, room.CurrentPlayerIndex, out _))
        {
            MoveToNextCrazyEightsPlayer(room);
        }
        else if (!CrazyEightsEngine.HasPlayableCard(room, room.CurrentPlayerIndex))
        {
            MoveToNextCrazyEightsPlayer(room);
        }

        await BroadcastCrazyEightsState(room);

        if (!room.IsOver && room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeCrazyEightsBotTurnAsync(room.Id);
    }

    public async Task RequestCrazyEightsHint(string roomId)
    {
        var room = _lobby.GetCrazyEightsRoom(roomId);
        if (room == null || !room.Started || room.IsOver) return;

        var me = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId && !p.IsBot);
        if (me == null) return;
        int idx = room.Players.IndexOf(me);
        if (idx < 0) return;

        var hint = CrazyEightsEngine.ComputeHint(room, idx);
        await Clients.Caller.SendAsync("CrazyEightsHint", hint);
    }

    public async Task LeaveCrazyEightsRoom(string roomId)
    {
        var room = _lobby.GetCrazyEightsRoom(roomId);
        if (room == null) return;

        var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);

        if (!room.Started)
        {
            if (player != null) room.Players.Remove(player);
            if (room.Players.Count == 0 || Context.ConnectionId == room.HostConnectionId)
            {
                await Clients.Group(roomId).SendAsync("CrazyEightsRoomDissolved");
                _lobby.RemoveCrazyEightsRoom(roomId);
            }
            else
            {
                await Clients.Group(roomId).SendAsync("CrazyEightsRoomUpdated", room);
            }
            await BroadcastCrazyEightsRooms();
            return;
        }

        if (player == null) return;

        if (room.IsSinglePlayer)
        {
            _lobby.RemoveCrazyEightsRoom(roomId);
            _lobby.SetInGame(Context.ConnectionId, false);
            await BroadcastLobby();
            return;
        }

        player.Connected = false;
        await Clients.Group(roomId).SendAsync("PlayerLeft", player.Name);

        var connectedHumans = room.Players.Where(p => !p.IsBot && p.Connected).ToList();
        if (connectedHumans.Count == 0)
        {
            _lobby.RemoveCrazyEightsRoom(roomId);
            await BroadcastCrazyEightsRooms();
            return;
        }

        if (connectedHumans.Count == 1 && !room.IsOver)
        {
            room.IsOver = true;
            room.WinnerName = connectedHumans[0].Name;
            await SaveCrazyEightsSessionsAsync(room);
            await BroadcastCrazyEightsState(room);
            return;
        }

        if (room.Players[room.CurrentPlayerIndex].ConnectionId == Context.ConnectionId)
            MoveToNextCrazyEightsPlayer(room);

        await BroadcastCrazyEightsState(room);

        if (!room.IsOver && room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeCrazyEightsBotTurnAsync(room.Id);
    }

    public async Task LeaveCrazyEightsGame(string roomId) => await LeaveCrazyEightsRoom(roomId);

    public async Task KickCrazyEightsPlayer(string roomId, string playerName)
    {
        var room = _lobby.GetCrazyEightsRoom(roomId);
        if (room == null || Context.ConnectionId != room.HostConnectionId) return;

        var player = room.Players.FirstOrDefault(p => p.Name == playerName && p.ConnectionId != room.HostConnectionId);
        if (player == null) return;

        await Clients.Client(player.ConnectionId).SendAsync("KickedFromRoom");
        await Groups.RemoveFromGroupAsync(player.ConnectionId, roomId);
        room.Players.Remove(player);

        await Clients.Group(roomId).SendAsync("CrazyEightsRoomUpdated", room);
        await BroadcastCrazyEightsRooms();
    }

    private async Task TakeCrazyEightsBotTurnAsync(string roomId)
    {
        await Task.Delay(Random.Shared.Next(650, 1300));

        var room = _lobby.GetCrazyEightsRoom(roomId);
        if (room == null || !room.Started || room.IsOver) return;

        var bot = room.Players[room.CurrentPlayerIndex];
        if (!bot.IsBot || bot.FinishRank > 0) return;

        var playable = CrazyEightsEngine.GetPlayableCards(room, bot)
            .OrderBy(c => CrazyEightsEngine.Rank(c) == CrazyEightsEngine.WildRank ? 1 : 0)
            .ToList();

        if (playable.Count == 0)
        {
            if (!CrazyEightsEngine.DrawOne(room, room.CurrentPlayerIndex, out _)
                || !CrazyEightsEngine.HasPlayableCard(room, room.CurrentPlayerIndex))
                MoveToNextCrazyEightsPlayer(room);

            await BroadcastCrazyEightsState(room);
            if (!room.IsOver && room.Players[room.CurrentPlayerIndex].IsBot)
                _ = TakeCrazyEightsBotTurnAsync(room.Id);
            return;
        }

        int card = playable[0];
        int? chosenSuit = CrazyEightsEngine.Rank(card) == CrazyEightsEngine.WildRank
            ? CrazyEightsEngine.BestSuitForHand(bot.Hand.Where(c => c != card))
            : null;

        CrazyEightsEngine.PlayCard(room, room.CurrentPlayerIndex, card, chosenSuit, out var won);

        if (won)
        {
            room.IsOver = true;
            room.WinnerName = bot.Name;
            await SaveCrazyEightsSessionsAsync(room);
        }
        else
        {
            MoveToNextCrazyEightsPlayer(room);
        }

        await BroadcastCrazyEightsState(room);

        if (!room.IsOver && room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeCrazyEightsBotTurnAsync(room.Id);
    }

    private void MoveToNextCrazyEightsPlayer(CrazyEightsRoom room)
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

    private object BuildCrazyEightsStateFor(CrazyEightsRoom room, string playerName)
    {
        var me = room.Players.FirstOrDefault(p => p.Name == playerName && !p.IsBot);
        var myHand = me?.Hand.ToList() ?? [];
        int playerIndex = me == null ? -1 : room.Players.IndexOf(me);
        bool myTurn = !room.IsOver && playerIndex == room.CurrentPlayerIndex;

        var legal = myTurn
            ? CrazyEightsEngine.GetPlayableCards(room, me!).Select(c => new
            {
                CardId = c,
                RequiresSuitChoice = CrazyEightsEngine.Rank(c) == CrazyEightsEngine.WildRank
            }).ToList()
            : [];

        return new
        {
            room.Id,
            room.Started,
            room.IsOver,
            room.IsSinglePlayer,
            room.WinnerName,
            room.CurrentPlayerIndex,
            room.ActiveSuit,
            TopCard = room.DiscardPile.Count > 0 ? room.DiscardPile[^1] : -1,
            DrawCount = room.DrawPile.Count,
            CanDraw = myTurn && !CrazyEightsEngine.HasPlayableCard(room, playerIndex) && CrazyEightsEngine.CanDraw(room),
            CanPass = myTurn && !CrazyEightsEngine.HasPlayableCard(room, playerIndex) && !CrazyEightsEngine.CanDraw(room),
            MyHand = myHand,
            LegalMoves = legal,
            Players = room.Players.Select((p, i) => new
            {
                p.Name,
                p.Connected,
                p.IsBot,
                CardCount = p.Hand.Count,
                p.Score,
                IsCurrent = i == room.CurrentPlayerIndex
            })
        };
    }

    private async Task BroadcastCrazyEightsState(CrazyEightsRoom room)
    {
        foreach (var p in room.Players.Where(p => !p.IsBot && p.Connected))
            await Clients.Client(p.ConnectionId).SendAsync("CrazyEightsUpdated", BuildCrazyEightsStateFor(room, p.Name));
    }

    private IEnumerable<object> CrazyEightsRoomSummaries() =>
        _lobby.GetOpenCrazyEightsRooms().Select(r => new
        {
            r.Id,
            r.HostName,
            RoomName = r.Settings.RoomName,
            PlayerCount = r.Players.Count,
            r.Settings.MaxPlayers,
            IsFull = r.Players.Count >= r.Settings.MaxPlayers,
            r.Started
        });

    private async Task BroadcastCrazyEightsRooms() =>
        await Clients.All.SendAsync("CrazyEightsRoomList", CrazyEightsRoomSummaries());

    private async Task SaveCrazyEightsSessionsAsync(CrazyEightsRoom room)
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

                var result = p.Name == room.WinnerName ? "Win" : "Loss";
                int score = p.Name == room.WinnerName
                    ? 400 + room.Players.Count * 25
                    : Math.Max(0, 250 - CrazyEightsEngine.ScoreForHand(p.Hand));

                await _sessions.SaveAsync(new GameSession
                {
                    UserId = uid.Value,
                    GameType = "CrazyEights",
                    Score = score,
                    Result = result,
                    TimePlayed = elapsed,
                    PlayedAt = now,
                    Details = $"CardsLeft:{p.Hand.Count},Players:{room.Players.Count}"
                });
            }
        }
        catch { }
    }
}
