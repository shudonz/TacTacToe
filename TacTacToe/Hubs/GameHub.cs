using System.Collections.Concurrent;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using TacTacToe.Services;

namespace TacTacToe.Hubs;

[Authorize]
public class GameHub : Hub
{
    private readonly LobbyService _lobby;
    private static readonly ConcurrentDictionary<string, (string target, string gameType)> PendingChallenges = new();

    public GameHub(LobbyService lobby) => _lobby = lobby;

    public override async Task OnConnectedAsync()
    {
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var email = Context.User?.FindFirst(ClaimTypes.Email)?.Value ?? "";
        var picture = Context.User?.FindFirst("picture")?.Value ?? "";
        _lobby.AddPlayer(Context.ConnectionId, name, email, picture);
        await BroadcastLobby();
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        _lobby.RemovePlayer(Context.ConnectionId);
        await BroadcastLobby();
        await base.OnDisconnectedAsync(exception);
    }

    public async Task Challenge(string targetConnectionId, string gameType = "tictactoe")
    {
        if (gameType != "tictactoe") return; // Yahtzee uses room system now
        if (targetConnectionId == Context.ConnectionId) return;
        var challenger = _lobby.GetPlayer(Context.ConnectionId);
        if (challenger == null) return;

        PendingChallenges[Context.ConnectionId] = (targetConnectionId, gameType);

        await Clients.Client(targetConnectionId).SendAsync("ChallengeReceived",
            Context.ConnectionId, challenger.Name, challenger.Picture, gameType);
    }

    public async Task AcceptChallenge(string challengerConnectionId)
    {
        if (!PendingChallenges.TryRemove(challengerConnectionId, out var pending)) return;
        if (pending.target != Context.ConnectionId) return;

        var gameId = Guid.NewGuid().ToString("N");

        var game = _lobby.CreateGame(gameId, challengerConnectionId, Context.ConnectionId);
        await Groups.AddToGroupAsync(challengerConnectionId, gameId);
        await Groups.AddToGroupAsync(Context.ConnectionId, gameId);
        await Clients.Client(challengerConnectionId).SendAsync("GameStarted", gameId, "X", game.XName, game.OName);
        await Clients.Client(Context.ConnectionId).SendAsync("GameStarted", gameId, "O", game.XName, game.OName);
    }

    public async Task DeclineChallenge(string challengerConnectionId)
    {
        PendingChallenges.TryRemove(challengerConnectionId, out _);
        var decliner = _lobby.GetPlayer(Context.ConnectionId);
        await Clients.Client(challengerConnectionId).SendAsync("ChallengeDeclined", decliner?.Name ?? "Someone");
    }

    public async Task JoinGame(string gameId, string mark)
    {
        var game = _lobby.GetGame(gameId);
        if (game == null) return;

        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";

        if (mark == "X" && game.XName == name)
            game.XConnectionId = Context.ConnectionId;
        else if (mark == "O" && game.OName == name)
            game.OConnectionId = Context.ConnectionId;
        else
            return;

        await Groups.AddToGroupAsync(Context.ConnectionId, gameId);
        await Clients.Caller.SendAsync("GameUpdated", game);
    }

    public async Task MakeMove(string gameId, int cell)
    {
        var game = _lobby.GetGame(gameId);
        if (game == null || game.IsOver) return;
        if (cell < 0 || cell > 8 || game.Board[cell] != null) return;

        var isX = Context.ConnectionId == game.XConnectionId;
        var isO = Context.ConnectionId == game.OConnectionId;
        if (!isX && !isO) return;
        if (isX && game.CurrentTurn != "X") return;
        if (isO && game.CurrentTurn != "O") return;

        game.Board[cell] = game.CurrentTurn;

        if (CheckWin(game.Board, game.CurrentTurn))
        {
            game.IsOver = true;
            game.Winner = game.CurrentTurn;
        }
        else if (game.Board.All(c => c != null))
        {
            game.IsOver = true;
            game.Winner = null;
        }
        else
        {
            game.CurrentTurn = game.CurrentTurn == "X" ? "O" : "X";
        }

        await Clients.Group(gameId).SendAsync("GameUpdated", game);
    }

    public async Task LeaveGame(string gameId)
    {
        var game = _lobby.GetGame(gameId);
        if (game != null)
        {
            if (!game.IsOver)
            {
                game.IsOver = true;
                game.Winner = Context.ConnectionId == game.XConnectionId ? "O" : "X";
                await Clients.Group(gameId).SendAsync("GameUpdated", game);
            }
            await Groups.RemoveFromGroupAsync(game.XConnectionId, gameId);
            await Groups.RemoveFromGroupAsync(game.OConnectionId, gameId);
            _lobby.RemoveGame(gameId);
        }
    }

    private async Task BroadcastLobby()
    {
        var players = _lobby.GetPlayers().Select(p => new
        {
            p.ConnectionId,
            p.Name,
            p.Picture
        });
        await Clients.All.SendAsync("LobbyUpdated", players);
    }

    private static bool CheckWin(string[] board, string mark)
    {
        int[][] wins =
        [
            [0, 1, 2], [3, 4, 5], [6, 7, 8],
            [0, 3, 6], [1, 4, 7], [2, 5, 8],
            [0, 4, 8], [2, 4, 6]
        ];
        return wins.Any(w => w.All(i => board[i] == mark));
    }

    /* ================================================================
       Yahtzee Room Methods
       ================================================================ */

    public async Task CreateYahtzeeRoom(string? roomName = null)
    {
        var roomId = Guid.NewGuid().ToString("N");
        var room = _lobby.CreateRoom(roomId, Context.ConnectionId);
        if (!string.IsNullOrWhiteSpace(roomName))
            room.Settings.RoomName = roomName.Trim()[..Math.Min(roomName.Trim().Length, 30)];
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Caller.SendAsync("YahtzeeRoomCreated", roomId);
        await BroadcastYahtzeeRooms();
    }

    public async Task GetYahtzeeRooms()
    {
        var rooms = _lobby.GetPublicRooms().Select(r => new
        {
            r.Id,
            r.HostName,
            PlayerCount = r.Players.Count,
            r.Settings.MaxPlayers,
            r.Settings.RoomName,
            r.Started,
            IsFull = r.Players.Count >= r.Settings.MaxPlayers
        });
        await Clients.Caller.SendAsync("YahtzeeRoomList", rooms);
    }

    public async Task JoinYahtzeeRoom(string roomId)
    {
        var room = _lobby.GetRoom(roomId);
        if (room == null || room.Started || room.IsOver) return;
        if (room.Players.Count >= room.Settings.MaxPlayers) return;
        if (room.Players.Any(p => p.ConnectionId == Context.ConnectionId)) return;

        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        room.Players.Add(new YahtzeePlayer { ConnectionId = Context.ConnectionId, Name = name });
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Group(roomId).SendAsync("YahtzeeRoomUpdated", room);
        await BroadcastYahtzeeRooms();
    }

    public async Task RejoinYahtzeeRoom(string roomId)
    {
        if (string.IsNullOrEmpty(roomId)) return;
        var room = _lobby.GetRoom(roomId);
        if (room == null) return;
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var player = room.Players.FirstOrDefault(p => p.Name == name);
        if (player == null) return;
        player.ConnectionId = Context.ConnectionId;
        player.Connected = true;
        if (room.HostName == name) room.HostConnectionId = Context.ConnectionId;
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        if (room.Started)
            await Clients.Caller.SendAsync("YahtzeeUpdated", room);
        else
            await Clients.Group(roomId).SendAsync("YahtzeeRoomUpdated", room);
    }

    public async Task UpdateYahtzeeSettings(string roomId, YahtzeeSettings settings)
    {
        var room = _lobby.GetRoom(roomId);
        if (room == null || room.Started) return;
        if (Context.ConnectionId != room.HostConnectionId) return;

        // Clamp values
        settings.MaxPlayers = Math.Clamp(settings.MaxPlayers, 2, 20);
        settings.RollsPerTurn = Math.Clamp(settings.RollsPerTurn, 1, 5);
        settings.NumberOfDice = Math.Clamp(settings.NumberOfDice, 3, 8);
        settings.UpperBonusThreshold = Math.Clamp(settings.UpperBonusThreshold, 0, 999);
        settings.UpperBonusPoints = Math.Clamp(settings.UpperBonusPoints, 0, 100);
        settings.TurnTimeLimitSeconds = Math.Clamp(settings.TurnTimeLimitSeconds, 0, 300);
        settings.FullHouseScore = Math.Clamp(settings.FullHouseScore, 0, 100);
        settings.SmallStraightScore = Math.Clamp(settings.SmallStraightScore, 0, 100);
        settings.LargeStraightScore = Math.Clamp(settings.LargeStraightScore, 0, 100);
        settings.YahtzeeScore = Math.Clamp(settings.YahtzeeScore, 0, 100);
        if (!string.IsNullOrWhiteSpace(settings.RoomName))
            settings.RoomName = settings.RoomName.Trim()[..Math.Min(settings.RoomName.Trim().Length, 30)];

        room.Settings = settings;
        await Clients.Group(roomId).SendAsync("YahtzeeRoomUpdated", room);
        await BroadcastYahtzeeRooms();
    }

    public async Task KickPlayer(string roomId, string playerName)
    {
        var room = _lobby.GetRoom(roomId);
        if (room == null || room.Started) return;
        if (Context.ConnectionId != room.HostConnectionId) return;
        var player = room.Players.FirstOrDefault(p => p.Name == playerName && p.ConnectionId != room.HostConnectionId);
        if (player == null) return;
        await Clients.Client(player.ConnectionId).SendAsync("KickedFromRoom");
        await Groups.RemoveFromGroupAsync(player.ConnectionId, roomId);
        room.Players.Remove(player);
        await Clients.Group(roomId).SendAsync("YahtzeeRoomUpdated", room);
        await BroadcastYahtzeeRooms();
    }

    public async Task StartYahtzeeGame(string roomId)
    {
        var room = _lobby.GetRoom(roomId);
        if (room == null || room.Started) return;
        if (Context.ConnectionId != room.HostConnectionId) return;
        if (room.Players.Count < 2) return;

        room.Started = true;
        room.CurrentPlayerIndex = 0;
        room.RollsLeft = room.Settings.RollsPerTurn;
        room.Dice = new int[room.Settings.NumberOfDice];
        room.Held = new bool[room.Settings.NumberOfDice];

        await Clients.Group(roomId).SendAsync("YahtzeeGameStarted", room);
        await BroadcastYahtzeeRooms();
    }

    public async Task YahtzeeRoll(string gameId)
    {
        var room = _lobby.GetRoom(gameId);
        if (room == null || !room.Started || room.IsOver || room.RollsLeft <= 0) return;
        if (Context.ConnectionId != room.CurrentPlayerConnectionId) return;

        YahtzeeScoring.RollDice(room);
        await Clients.Group(gameId).SendAsync("YahtzeeUpdated", room);
    }

    public async Task YahtzeeToggleHold(string gameId, int dieIndex)
    {
        var room = _lobby.GetRoom(gameId);
        if (room == null || !room.Started || room.IsOver) return;
        if (dieIndex < 0 || dieIndex >= room.Settings.NumberOfDice) return;
        if (Context.ConnectionId != room.CurrentPlayerConnectionId) return;
        if (room.RollsLeft == room.Settings.RollsPerTurn) return;

        room.Held[dieIndex] = !room.Held[dieIndex];
        await Clients.Group(gameId).SendAsync("YahtzeeUpdated", room);
    }

    public async Task YahtzeeScore(string gameId, string category)
    {
        var room = _lobby.GetRoom(gameId);
        if (room == null || !room.Started || room.IsOver) return;
        if (Context.ConnectionId != room.CurrentPlayerConnectionId) return;
        if (room.RollsLeft == room.Settings.RollsPerTurn) return;

        var player = room.Players[room.CurrentPlayerIndex];
        if (!player.Scores.ContainsKey(category) || player.Scores[category] != null) return;

        player.Scores[category] = YahtzeeScoring.CalculateScore(category, room.Dice, room.Settings);

        // Check if all players filled all 13
        bool allDone = room.Players.All(p => p.Scores.Values.All(v => v != null));

        if (allDone)
        {
            room.IsOver = true;
            var best = room.Players
                .OrderByDescending(p => YahtzeeScoring.TotalScore(p.Scores, room.Settings))
                .First();
            room.WinnerName = best.Name;
        }
        else
        {
            // Advance to next player
            do
            {
                room.CurrentPlayerIndex = (room.CurrentPlayerIndex + 1) % room.Players.Count;
            }
            while (!room.Players[room.CurrentPlayerIndex].Connected && !allDone);

            room.RollsLeft = room.Settings.RollsPerTurn;
            room.Held = new bool[room.Settings.NumberOfDice];
            room.Dice = new int[room.Settings.NumberOfDice];
        }

        await Clients.Group(gameId).SendAsync("YahtzeeUpdated", room);
    }

    public async Task LeaveYahtzee(string roomId)
    {
        var room = _lobby.GetRoom(roomId);
        if (room == null) return;

        var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        if (player != null) player.Connected = false;
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);

        if (!room.Started)
        {
            // Pre-game: remove player entirely
            if (player != null) room.Players.Remove(player);

            // If host left, assign new host or delete room
            if (Context.ConnectionId == room.HostConnectionId)
            {
                if (room.Players.Count > 0)
                {
                    room.HostConnectionId = room.Players[0].ConnectionId;
                    room.HostName = room.Players[0].Name;
                    await Clients.Group(roomId).SendAsync("YahtzeeRoomUpdated", room);
                }
                else
                {
                    _lobby.RemoveRoom(roomId);
                }
            }
            else
            {
                await Clients.Group(roomId).SendAsync("YahtzeeRoomUpdated", room);
            }
        }
        else
        {
            // Mid-game: if all disconnected, clean up
            if (room.Players.All(p => !p.Connected))
            {
                _lobby.RemoveRoom(roomId);
            }
            else
            {
                // If it's the leaving player's turn, skip them
                if (room.CurrentPlayerConnectionId == Context.ConnectionId && !room.IsOver)
                {
                    room.CurrentPlayerIndex = (room.CurrentPlayerIndex + 1) % room.Players.Count;
                    room.RollsLeft = room.Settings.RollsPerTurn;
                    room.Held = new bool[room.Settings.NumberOfDice];
                    room.Dice = new int[room.Settings.NumberOfDice];
                }
                await Clients.Group(roomId).SendAsync("YahtzeeUpdated", room);
            }
        }
        await BroadcastYahtzeeRooms();
    }

    public async Task SendChat(string groupId, string message)
    {
        if (string.IsNullOrWhiteSpace(message)) return;
        message = message.Trim();
        if (message.Length > 500) message = message[..500];
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        await Clients.Group(groupId).SendAsync("ChatMessage", name, message, DateTime.UtcNow);
    }

    public async Task SendLobbyChat(string message)
    {
        if (string.IsNullOrWhiteSpace(message)) return;
        message = message.Trim();
        if (message.Length > 500) message = message[..500];
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        await Clients.All.SendAsync("LobbyChatMessage", name, message, DateTime.UtcNow);
    }

    private async Task BroadcastYahtzeeRooms()
    {
        var rooms = _lobby.GetPublicRooms().Select(r => new
        {
            r.Id,
            r.HostName,
            PlayerCount = r.Players.Count,
            r.Settings.MaxPlayers,
            r.Settings.RoomName,
            r.Started
        });
        await Clients.All.SendAsync("YahtzeeRoomList", rooms);
    }
}
