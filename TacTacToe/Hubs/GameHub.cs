using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using TacTacToe.Services;

namespace TacTacToe.Hubs;

[Authorize]
public class GameHub : Hub
{
    private readonly LobbyService _lobby;
    private readonly IHubContext<GameHub> _hubContext;

    public GameHub(LobbyService lobby, IHubContext<GameHub> hubContext)
    {
        _lobby = lobby;
        _hubContext = hubContext;
    }

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
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var disconnectedConnectionId = Context.ConnectionId;

        // Defer TTT room cleanup — the same grace period used for Yahtzee is needed here
        // because creating/joining a room causes a page navigation which disconnects the
        // lobby connection before RejoinTttRoom can update the player's ConnectionId.
        var tttSnapshot = _lobby.GetTttRoomsForConnection(disconnectedConnectionId).ToList();
        if (tttSnapshot.Count > 0)
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(TimeSpan.FromSeconds(8));
                bool changed = false;
                foreach (var snap in tttSnapshot)
                {
                    var room = _lobby.GetTttRoom(snap.Id);
                    if (room == null || room.Started) continue;
                    var player = room.Players.FirstOrDefault(p => p.Name == name);
                    // If the player rejoined, RejoinTttRoom will have updated their ConnectionId
                    if (player == null || player.ConnectionId != disconnectedConnectionId) continue;

                    room.Players.Remove(player);
                    changed = true;
                    if (room.Players.Count == 0 || room.HostName == name)
                    {
                        await _hubContext.Clients.Group(room.Id).SendAsync("TttRoomDissolved");
                        _lobby.RemoveTttRoom(room.Id);
                    }
                    else
                    {
                        await _hubContext.Clients.Group(room.Id).SendAsync("TttRoomUpdated", room);
                    }
                }
                if (changed)
                    await _hubContext.Clients.All.SendAsync("TttRoomList", TttRoomSummaries());
            });
        }

        // Defer Yahtzee mid-game disconnect handling to give page-navigations time to rejoin
        var roomsSnapshot = _lobby.GetActiveRoomsForConnection(disconnectedConnectionId).ToList();
        if (roomsSnapshot.Count > 0)
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(TimeSpan.FromSeconds(10));
                foreach (var snapshot in roomsSnapshot)
                {
                    var room = _lobby.GetRoom(snapshot.Id);
                    if (room == null || room.IsOver) continue;
                    var player = room.Players.FirstOrDefault(p => p.Name == name);
                    if (player == null || player.ConnectionId != disconnectedConnectionId) continue;
                    await HandleYahtzeePlayerDisconnected(room, disconnectedConnectionId, name);
                }
            });
        }

        _lobby.RemovePlayer(disconnectedConnectionId);
        await BroadcastLobby();
        await base.OnDisconnectedAsync(exception);
    }

    private async Task HandleYahtzeePlayerDisconnected(YahtzeeRoom room, string connectionId, string playerName)
    {
        var player = room.Players.FirstOrDefault(p => p.ConnectionId == connectionId);
        if (player == null) return;

        player.Connected = false;

        // Notify remaining players (connection is gone so use _hubContext, not Groups)
        await _hubContext.Clients.Group(room.Id).SendAsync("PlayerLeft", playerName);

        // If no human players remain, clean up silently
        if (room.Players.Where(p => !p.IsBot).All(p => !p.Connected))
        {
            _lobby.RemoveRoom(room.Id);
            return;
        }

        // If it was the leaving player's turn, advance to the next connected player
        if (room.CurrentPlayerConnectionId == connectionId)
        {
            int next = room.CurrentPlayerIndex;
            int tries = 0;
            do
            {
                next = (next + 1) % room.Players.Count;
                tries++;
            }
            while (!room.Players[next].Connected && tries < room.Players.Count);

            room.CurrentPlayerIndex = next;
            room.RollsLeft = room.Settings.RollsPerTurn;
            room.Held = new bool[room.Settings.NumberOfDice];
            room.Dice = new int[room.Settings.NumberOfDice];

            // Trigger AI turn if the next player is a bot
            var nextPlayer = room.Players[next];
            if (nextPlayer.IsBot && !room.IsOver)
                _ = TakeYahtzeeAiBotTurnAsync(room.Id, nextPlayer.AiDifficulty);
        }

        await _hubContext.Clients.Group(room.Id).SendAsync("YahtzeeUpdated", room);
        await BroadcastYahtzeeRooms();
    }

    /* ================================================================
       TTT Room Methods
       ================================================================ */

    public async Task CreateTttRoom(string? roomName = null)
    {
        var roomId = Guid.NewGuid().ToString("N");
        var room = _lobby.CreateTttRoom(roomId, Context.ConnectionId);
        if (!string.IsNullOrWhiteSpace(roomName))
            room.RoomName = roomName.Trim()[..Math.Min(roomName.Trim().Length, 30)];
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Caller.SendAsync("TttRoomCreated", roomId);
        await BroadcastTttRooms();
    }

    public async Task GetTttRooms()
    {
        await Clients.Caller.SendAsync("TttRoomList", TttRoomSummaries());
    }

    public async Task JoinTttRoom(string roomId)
    {
        var room = _lobby.GetTttRoom(roomId);
        if (room == null || room.Started || room.IsOver) return;
        if (room.Players.Count >= 2) return;
        if (room.Players.Any(p => p.ConnectionId == Context.ConnectionId)) return;

        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        room.Players.Add(new TttPlayer { ConnectionId = Context.ConnectionId, Name = name });
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Group(roomId).SendAsync("TttRoomUpdated", room);
        await BroadcastTttRooms();
    }

    public async Task RejoinTttRoom(string roomId)
    {
        if (string.IsNullOrEmpty(roomId)) return;
        var room = _lobby.GetTttRoom(roomId);
        if (room == null || room.Started) return;
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var player = room.Players.FirstOrDefault(p => p.Name == name);
        if (player == null) return;
        player.ConnectionId = Context.ConnectionId;
        if (room.HostName == name) room.HostConnectionId = Context.ConnectionId;
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Group(roomId).SendAsync("TttRoomUpdated", room);
    }

    public async Task StartTttGame(string roomId)
    {
        var room = _lobby.GetTttRoom(roomId);
        if (room == null || room.Started) return;
        if (Context.ConnectionId != room.HostConnectionId) return;
        if (room.Players.Count < 2) return;

        room.Started = true;
        var gameId = Guid.NewGuid().ToString("N");
        var x = room.Players[0]; // host plays X
        var o = room.Players[1];

        var game = new GameState
        {
            Id = gameId,
            XConnectionId = x.ConnectionId,
            OConnectionId = o.ConnectionId,
            XName = x.Name,
            OName = o.Name,
            Board = new string[9],
            CurrentTurn = "X",
            IsOver = false
        };
        _lobby.StoreGame(gameId, game);
        await Groups.AddToGroupAsync(x.ConnectionId, gameId);
        await Groups.AddToGroupAsync(o.ConnectionId, gameId);
        await Clients.Client(x.ConnectionId).SendAsync("GameStarted", gameId, "X", x.Name, o.Name);
        await Clients.Client(o.ConnectionId).SendAsync("GameStarted", gameId, "O", x.Name, o.Name);

        _lobby.RemoveTttRoom(roomId);
        await BroadcastTttRooms();
    }

    public async Task LeaveTttRoom(string roomId)
    {
        var room = _lobby.GetTttRoom(roomId);
        if (room == null) return;

        var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);
        if (player != null) room.Players.Remove(player);

        if (room.Players.Count == 0 || Context.ConnectionId == room.HostConnectionId)
        {
            await Clients.Group(roomId).SendAsync("TttRoomDissolved");
            _lobby.RemoveTttRoom(roomId);
        }
        else
        {
            await Clients.Group(roomId).SendAsync("TttRoomUpdated", room);
        }
        await BroadcastTttRooms();
    }

    public async Task KickTttPlayer(string roomId, string playerName)
    {
        var room = _lobby.GetTttRoom(roomId);
        if (room == null) return;
        if (Context.ConnectionId != room.HostConnectionId) return;
        var player = room.Players.FirstOrDefault(p => p.Name == playerName && p.ConnectionId != room.HostConnectionId);
        if (player == null) return;
        await Clients.Client(player.ConnectionId).SendAsync("KickedFromRoom");
        await Groups.RemoveFromGroupAsync(player.ConnectionId, roomId);
        room.Players.Remove(player);
        await Clients.Group(roomId).SendAsync("TttRoomUpdated", room);
        await BroadcastTttRooms();
    }

    private IEnumerable<object> TttRoomSummaries() =>
        _lobby.GetOpenTttRooms().Select(r => new
        {
            r.Id,
            r.HostName,
            r.RoomName,
            PlayerCount = r.Players.Count,
            IsFull = r.Players.Count >= 2
        });

    private async Task BroadcastTttRooms() =>
        await Clients.All.SendAsync("TttRoomList", TttRoomSummaries());

    public async Task StartSinglePlayerTTT(string difficulty)
    {
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var gameId = Guid.NewGuid().ToString("N");
        var aiName = difficulty == "hard" ? "🤖 Computer (Hard)" : "🤖 Computer";

        var game = new GameState
        {
            Id = gameId,
            XConnectionId = Context.ConnectionId,
            OConnectionId = "BOT_" + gameId,
            XName = name,
            OName = aiName,
            Board = new string[9],
            CurrentTurn = "X",
            IsSinglePlayer = true,
            AiDifficulty = difficulty
        };
        _lobby.StoreGame(gameId, game);

        await Groups.AddToGroupAsync(Context.ConnectionId, gameId);
        await Clients.Caller.SendAsync("GameStarted", gameId, "X", name, aiName);
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
        _lobby.SetInGame(Context.ConnectionId, true);
        await BroadcastLobby();
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

        // Trigger AI move for single-player games
        if (!game.IsOver && game.IsSinglePlayer && game.CurrentTurn == "O")
            _ = TakeTttAiMoveAsync(gameId);
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
        var players = _lobby.GetLobbyPlayers().Select(p => new
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
        {
            _lobby.SetInGame(Context.ConnectionId, true);
            await BroadcastLobby();
            await Clients.Caller.SendAsync("YahtzeeUpdated", room);
        }
        else
        {
            await Clients.Group(roomId).SendAsync("YahtzeeRoomUpdated", room);
        }
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

        await AdvanceYahtzeeScore(gameId, room, category);
    }

    // Shared scoring logic used by both the hub method and the AI bot
    private async Task AdvanceYahtzeeScore(string gameId, YahtzeeRoom room, string category)
    {
        var player = room.Players[room.CurrentPlayerIndex];
        player.Scores[category] = YahtzeeScoring.CalculateScore(category, room.Dice, room.Settings);

        bool allDone = room.Players.All(p => p.Scores.Values.All(v => v != null));
        if (allDone)
        {
            room.IsOver = true;
            room.WinnerName = room.Players
                .OrderByDescending(p => YahtzeeScoring.TotalScore(p.Scores, room.Settings))
                .First().Name;
            await _hubContext.Clients.Group(gameId).SendAsync("YahtzeeUpdated", room);
        }
        else
        {
            do
            {
                room.CurrentPlayerIndex = (room.CurrentPlayerIndex + 1) % room.Players.Count;
            }
            while (!room.Players[room.CurrentPlayerIndex].Connected);

            room.RollsLeft = room.Settings.RollsPerTurn;
            room.Held = new bool[room.Settings.NumberOfDice];
            room.Dice = new int[room.Settings.NumberOfDice];

            await _hubContext.Clients.Group(gameId).SendAsync("YahtzeeUpdated", room);

            // If the next player is an AI bot, trigger its turn
            var next = room.Players[room.CurrentPlayerIndex];
            if (next.IsBot && !room.IsOver)
                _ = TakeYahtzeeAiBotTurnAsync(gameId, next.AiDifficulty);
        }
    }

    public async Task StartYahtzeeSinglePlayer(string difficulty)
    {
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var roomId = Guid.NewGuid().ToString("N");
        var aiName = difficulty == "hard" ? "🤖 Computer (Hard)" : "🤖 Computer";

        var room = new YahtzeeRoom
        {
            Id = roomId,
            HostConnectionId = Context.ConnectionId,
            HostName = name,
            IsSinglePlayer = true,
            Players =
            [
                new YahtzeePlayer { ConnectionId = Context.ConnectionId, Name = name, Connected = true },
                new YahtzeePlayer { ConnectionId = "BOT_" + roomId, Name = aiName, IsBot = true, AiDifficulty = difficulty, Connected = true }
            ]
        };
        room.Settings.MaxPlayers = 2;
        room.Settings.RoomName = "vs Computer";
        room.Started = true;
        room.CurrentPlayerIndex = 0;
        room.RollsLeft = room.Settings.RollsPerTurn;
        room.Dice = new int[room.Settings.NumberOfDice];
        room.Held = new bool[room.Settings.NumberOfDice];

        _lobby.StoreRoom(roomId, room);
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Caller.SendAsync("YahtzeeSinglePlayerStarted", roomId);
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
            r.Started,
            IsFull = r.Players.Count >= r.Settings.MaxPlayers
        });
        await Clients.All.SendAsync("YahtzeeRoomList", rooms);
    }

    /* ================================================================
       Tic-Tac-Toe AI
       ================================================================ */

    private async Task TakeTttAiMoveAsync(string gameId)
    {
        try
        {
            await Task.Delay(520);
            var game = _lobby.GetGame(gameId);
            if (game == null || game.IsOver || game.CurrentTurn != "O") return;

            int cell = game.AiDifficulty == "hard"
                ? TttMinimaxBestMove(game.Board)
                : TttRandomMove(game.Board);
            if (cell < 0 || game.Board[cell] != null) return;

            game.Board[cell] = "O";
            if (CheckWin(game.Board, "O"))        { game.IsOver = true; game.Winner = "O"; }
            else if (game.Board.All(c => c != null)) { game.IsOver = true; game.Winner = null; }
            else                                    game.CurrentTurn = "X";

            await _hubContext.Clients.Group(gameId).SendAsync("GameUpdated", game);
        }
        catch { }
    }

    private static int TttRandomMove(string[] board)
    {
        var empty = board.Select((v, i) => (v, i)).Where(x => x.v == null).Select(x => x.i).ToList();
        return empty.Count > 0 ? empty[Random.Shared.Next(empty.Count)] : -1;
    }

    private static int TttMinimaxBestMove(string[] board)
    {
        int bestScore = int.MinValue, bestMove = -1;
        for (int i = 0; i < 9; i++)
        {
            if (board[i] != null) continue;
            board[i] = "O";
            int score = TttMinimax(board, false, 0);
            board[i] = null;
            if (score > bestScore) { bestScore = score; bestMove = i; }
        }
        return bestMove;
    }

    private static int TttMinimax(string[] board, bool maximising, int depth)
    {
        if (CheckWin(board, "O")) return 10 - depth;
        if (CheckWin(board, "X")) return depth - 10;
        if (board.All(c => c != null)) return 0;

        if (maximising)
        {
            int best = int.MinValue;
            for (int i = 0; i < 9; i++)
            {
                if (board[i] != null) continue;
                board[i] = "O";
                best = Math.Max(best, TttMinimax(board, false, depth + 1));
                board[i] = null;
            }
            return best;
        }
        else
        {
            int best = int.MaxValue;
            for (int i = 0; i < 9; i++)
            {
                if (board[i] != null) continue;
                board[i] = "X";
                best = Math.Min(best, TttMinimax(board, true, depth + 1));
                board[i] = null;
            }
            return best;
        }
    }

    /* ================================================================
       Yahtzee AI
       ================================================================ */

    private async Task TakeYahtzeeAiBotTurnAsync(string gameId, string difficulty)
    {
        try
        {
            var room = _lobby.GetRoom(gameId);
            if (room == null || room.IsOver) return;

            // Perform all rolls with think-pauses between them
            while (room.RollsLeft > 0 && !room.IsOver)
            {
                await Task.Delay(900);
                YahtzeeScoring.RollDice(room);
                await _hubContext.Clients.Group(gameId).SendAsync("YahtzeeUpdated", room);

                if (room.RollsLeft > 0)
                {
                    await Task.Delay(750);
                    room.Held = difficulty == "hard"
                        ? YahtzeeHardHold(room)
                        : YahtzeeEasyHold(room);
                    await _hubContext.Clients.Group(gameId).SendAsync("YahtzeeUpdated", room);
                }
            }

            await Task.Delay(750);

            // Choose and apply a scoring category
            string category = difficulty == "hard"
                ? YahtzeeHardScore(room)
                : YahtzeeEasyScore(room);

            await AdvanceYahtzeeScore(gameId, room, category);
        }
        catch { }
    }

    // Easy: hold the most-frequent face; fall back to highest single die
    private static bool[] YahtzeeEasyHold(YahtzeeRoom room)
    {
        var dice = room.Dice;
        var held = new bool[dice.Length];
        var counts = new int[7];
        foreach (var d in dice) counts[d]++;

        int maxCount = counts.Skip(1).Max();
        if (maxCount <= 1)
        {
            int maxVal = dice.Max();
            for (int i = 0; i < dice.Length; i++)
                if (dice[i] == maxVal) { held[i] = true; break; }
        }
        else
        {
            int face = Array.IndexOf(counts, maxCount, 1);
            for (int i = 0; i < dice.Length; i++)
                if (dice[i] == face) held[i] = true;
        }
        return held;
    }

    // Hard: strategic hold — chase Yahtzee > full house > straight > pairs
    private static bool[] YahtzeeHardHold(YahtzeeRoom room)
    {
        var dice = room.Dice;
        var held = new bool[dice.Length];
        var counts = new int[7];
        foreach (var d in dice) counts[d]++;
        var scores = room.Players[room.CurrentPlayerIndex].Scores;

        int maxCount = counts.Skip(1).Max();
        int maxFace = Array.IndexOf(counts, maxCount, 1);

        // 1 – Chase Yahtzee (4+ of a kind)
        if (maxCount >= 4 && scores.GetValueOrDefault("yahtzee") == null)
        {
            for (int i = 0; i < dice.Length; i++)
                if (dice[i] == maxFace) held[i] = true;
            return held;
        }

        // 2 – Full house (3-of + 2-of)
        if (maxCount >= 3 && scores.GetValueOrDefault("fullHouse") == null)
        {
            for (int i = 0; i < dice.Length; i++)
                if (dice[i] == maxFace) held[i] = true;
            if (maxCount == 3)
            {
                int pairFace = counts.Select((c, idx) => (c, idx)).Skip(1)
                                     .FirstOrDefault(x => x.c == 2).idx;
                if (pairFace > 0)
                    for (int i = 0; i < dice.Length; i++)
                        if (dice[i] == pairFace) held[i] = true;
            }
            return held;
        }

        // 3 – Chase 3/4 of a kind or Yahtzee
        if (maxCount >= 3)
        {
            for (int i = 0; i < dice.Length; i++)
                if (dice[i] == maxFace) held[i] = true;
            return held;
        }

        // 4 – Straight potential
        var unique = dice.Distinct().OrderBy(d => d).ToList();
        int run = LongestRun(unique);
        if (run >= 3 && (scores.GetValueOrDefault("largeStraight") == null || scores.GetValueOrDefault("smallStraight") == null))
        {
            var keep = BestStraightVals(unique);
            bool[] usedVal = new bool[7];
            for (int i = 0; i < dice.Length; i++)
            {
                if (keep.Contains(dice[i]) && !usedVal[dice[i]])
                { held[i] = true; usedVal[dice[i]] = true; }
            }
            return held;
        }

        // 5 – Keep any pair
        if (maxCount >= 2)
        {
            for (int i = 0; i < dice.Length; i++)
                if (dice[i] == maxFace) held[i] = true;
            return held;
        }

        // Default: keep highest die
        int hi = dice.Max();
        for (int i = 0; i < dice.Length; i++) if (dice[i] == hi) { held[i] = true; break; }
        return held;
    }

    private static int LongestRun(List<int> sorted)
    {
        if (sorted.Count == 0) return 0;
        int run = 1, max = 1;
        for (int i = 1; i < sorted.Count; i++)
        {
            if (sorted[i] == sorted[i - 1] + 1) { run++; max = Math.Max(max, run); }
            else run = 1;
        }
        return max;
    }

    private static HashSet<int> BestStraightVals(List<int> sorted)
    {
        // Test each 4-window and 5-window, pick the one with most matches
        int[][] windows = [[1,2,3,4],[2,3,4,5],[3,4,5,6],[1,2,3,4,5],[2,3,4,5,6]];
        var set = new HashSet<int>(sorted);
        HashSet<int>? best = null;
        int bestMatch = 0;
        foreach (var w in windows)
        {
            int match = w.Count(v => set.Contains(v));
            if (match > bestMatch) { bestMatch = match; best = new HashSet<int>(w.Where(v => set.Contains(v))); }
        }
        return best ?? [];
    }

    // Easy score: random pick from categories that score > 0; else random available
    private static string YahtzeeEasyScore(YahtzeeRoom room)
    {
        var player = room.Players[room.CurrentPlayerIndex];
        var available = YahtzeeScoring.Categories
            .Where(c => player.Scores.GetValueOrDefault(c) == null).ToList();
        var nonZero = available
            .Where(c => YahtzeeScoring.CalculateScore(c, room.Dice, room.Settings) > 0).ToList();
        var pool = nonZero.Count > 0 ? nonZero : available;
        return pool[Random.Shared.Next(pool.Count)];
    }

    // Hard score: always pick the category that maximises current score
    private static string YahtzeeHardScore(YahtzeeRoom room)
    {
        var player = room.Players[room.CurrentPlayerIndex];
        return YahtzeeScoring.Categories
            .Where(c => player.Scores.GetValueOrDefault(c) == null)
            .OrderByDescending(c => YahtzeeScoring.CalculateScore(c, room.Dice, room.Settings))
            .First();
    }
}
