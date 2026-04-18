using System.Collections.Concurrent;

namespace TacTacToe.Services;

public class LobbyService
{
    private readonly ConcurrentDictionary<string, LobbyPlayer> _players = new();
    private readonly ConcurrentDictionary<string, GameState> _games = new();
    private readonly ConcurrentDictionary<string, YahtzeeRoom> _yahtzeeRooms = new();
    private readonly ConcurrentDictionary<string, TttRoom> _tttRooms = new();
    private readonly ConcurrentDictionary<string, SlotsRoom> _slotsRooms = new();

    public bool AddPlayer(string connectionId, string name, string email, string picture)
    {
        return _players.TryAdd(connectionId, new LobbyPlayer(connectionId, name, email, picture));
    }

    public bool RemovePlayer(string connectionId)
    {
        return _players.TryRemove(connectionId, out _);
    }

    public IEnumerable<LobbyPlayer> GetPlayers() => _players.Values;

    public LobbyPlayer? GetPlayer(string connectionId)
    {
        _players.TryGetValue(connectionId, out var p);
        return p;
    }

    public void SetInGame(string connectionId, bool inGame)
    {
        if (_players.TryGetValue(connectionId, out var p))
            p.InGame = inGame;
    }

    public IEnumerable<LobbyPlayer> GetLobbyPlayers() =>
        _players.Values.Where(p => !p.InGame);

    public GameState CreateGame(string id, string xConnectionId, string oConnectionId)
    {
        var x = _players.GetValueOrDefault(xConnectionId);
        var o = _players.GetValueOrDefault(oConnectionId);
        var game = new GameState
        {
            Id = id,
            XConnectionId = xConnectionId,
            OConnectionId = oConnectionId,
            XName = x?.Name ?? "X",
            OName = o?.Name ?? "O",
            Board = new string[9],
            CurrentTurn = "X",
            IsOver = false
        };
        _games[id] = game;
        return game;
    }

    public GameState? GetGame(string id)
    {
        _games.TryGetValue(id, out var g);
        return g;
    }

    public void StoreGame(string id, GameState game) => _games[id] = game;

    public void RemoveGame(string id) => _games.TryRemove(id, out _);

    public IEnumerable<GameState> GetGamesForConnection(string connectionId) =>
        _games.Values.Where(g => !g.IsSinglePlayer &&
            (g.XConnectionId == connectionId || g.OConnectionId == connectionId));

    // --- TTT Rooms ---

    public TttRoom CreateTttRoom(string id, string hostConnectionId)
    {
        var host = _players.GetValueOrDefault(hostConnectionId);
        var room = new TttRoom
        {
            Id = id,
            HostConnectionId = hostConnectionId,
            HostName = host?.Name ?? "Host",
            Players = [new TttPlayer { ConnectionId = hostConnectionId, Name = host?.Name ?? "Host" }]
        };
        _tttRooms[id] = room;
        return room;
    }

    public TttRoom? GetTttRoom(string id)
    {
        _tttRooms.TryGetValue(id, out var r);
        return r;
    }

    public void StoreTttRoom(string id, TttRoom room) => _tttRooms[id] = room;

    public IEnumerable<TttRoom> GetOpenTttRooms() =>
        _tttRooms.Values.Where(r => !r.Started && !r.IsOver);

    public IEnumerable<TttRoom> GetTttRoomsForConnection(string connectionId) =>
        _tttRooms.Values.Where(r => !r.Started && r.Players.Any(p => p.ConnectionId == connectionId));

    public void RemoveTttRoom(string id) => _tttRooms.TryRemove(id, out _);

    // --- Yahtzee Rooms ---

    public YahtzeeRoom CreateRoom(string id, string hostConnectionId)
    {
        var host = _players.GetValueOrDefault(hostConnectionId);
        var room = new YahtzeeRoom
        {
            Id = id,
            HostConnectionId = hostConnectionId,
            HostName = host?.Name ?? "Host",
            Players = [new YahtzeePlayer { ConnectionId = hostConnectionId, Name = host?.Name ?? "Host" }]
        };
        _yahtzeeRooms[id] = room;
        return room;
    }

    public YahtzeeRoom? GetRoom(string id)
    {
        _yahtzeeRooms.TryGetValue(id, out var r);
        return r;
    }

    public void StoreRoom(string id, YahtzeeRoom room) => _yahtzeeRooms[id] = room;

    public IEnumerable<YahtzeeRoom> GetPublicRooms() =>
        _yahtzeeRooms.Values.Where(r => !r.Settings.IsPrivate && !r.Started && !r.IsOver);

    public IEnumerable<YahtzeeRoom> GetActiveRoomsForConnection(string connectionId) =>
        _yahtzeeRooms.Values.Where(r => r.Started && !r.IsOver &&
            r.Players.Any(p => p.ConnectionId == connectionId));

    public void RemoveRoom(string id) => _yahtzeeRooms.TryRemove(id, out _);

    // --- Slots Rooms ---

    public SlotsRoom CreateSlotsRoom(string id, string hostConnectionId)
    {
        var host = _players.GetValueOrDefault(hostConnectionId);
        var room = new SlotsRoom
        {
            Id = id,
            HostConnectionId = hostConnectionId,
            HostName = host?.Name ?? "Host",
            Players = [new SlotsPlayer { ConnectionId = hostConnectionId, Name = host?.Name ?? "Host", Connected = true }]
        };
        _slotsRooms[id] = room;
        return room;
    }

    public SlotsRoom? GetSlotsRoom(string id) { _slotsRooms.TryGetValue(id, out var r); return r; }
    public void StoreSlotsRoom(string id, SlotsRoom room) => _slotsRooms[id] = room;

    public IEnumerable<SlotsRoom> GetOpenSlotsRooms() =>
        _slotsRooms.Values.Where(r => !r.Started && !r.IsOver);

    public IEnumerable<SlotsRoom> GetSlotsRoomsForConnection(string connectionId) =>
        _slotsRooms.Values.Where(r => !r.Started && r.Players.Any(p => p.ConnectionId == connectionId));

    public IEnumerable<SlotsRoom> GetActiveSlotsRoomsForConnection(string connectionId) =>
        _slotsRooms.Values.Where(r => r.Started && !r.IsOver &&
            r.Players.Any(p => p.ConnectionId == connectionId && !p.IsBot));

    public void RemoveSlotsRoom(string id) => _slotsRooms.TryRemove(id, out _);
}

public class LobbyPlayer
{
    public string ConnectionId { get; set; }
    public string Name { get; set; }
    public string Email { get; set; }
    public string Picture { get; set; }
    public bool InGame { get; set; }

    public LobbyPlayer(string connectionId, string name, string email, string picture)
    {
        ConnectionId = connectionId;
        Name = name;
        Email = email;
        Picture = picture;
    }
}

public class GameState
{
    public string Id { get; set; } = "";
    public string XConnectionId { get; set; } = "";
    public string OConnectionId { get; set; } = "";
    public string XName { get; set; } = "";
    public string OName { get; set; } = "";
    public string[] Board { get; set; } = new string[9];
    public string CurrentTurn { get; set; } = "X";
    public bool IsOver { get; set; }
    public string? Winner { get; set; }
    public bool IsSinglePlayer { get; set; }
    public string AiDifficulty { get; set; } = "regular";
    public bool RematchRequestedByX { get; set; }
    public bool RematchRequestedByO { get; set; }
}

public class TttRoom
{
    public string Id { get; set; } = "";
    public string HostConnectionId { get; set; } = "";
    public string HostName { get; set; } = "";
    public string RoomName { get; set; } = "Tic Tac Toe";
    public List<TttPlayer> Players { get; set; } = [];
    public bool Started { get; set; }
    public bool IsOver { get; set; }
}

public class TttPlayer
{
    public string ConnectionId { get; set; } = "";
    public string Name { get; set; } = "";
}
