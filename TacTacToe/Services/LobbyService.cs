using System.Collections.Concurrent;

namespace TacTacToe.Services;

public class LobbyService
{
    private readonly ConcurrentDictionary<string, LobbyPlayer> _players = new();
    private readonly ConcurrentDictionary<string, GameState> _games = new();
    private readonly ConcurrentDictionary<string, YahtzeeRoom> _yahtzeeRooms = new();

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

    public void RemoveGame(string id) => _games.TryRemove(id, out _);

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

    public IEnumerable<YahtzeeRoom> GetPublicRooms() =>
        _yahtzeeRooms.Values.Where(r => !r.Settings.IsPrivate && !r.Started && !r.IsOver);

    public void RemoveRoom(string id) => _yahtzeeRooms.TryRemove(id, out _);
}

public class LobbyPlayer
{
    public string ConnectionId { get; set; }
    public string Name { get; set; }
    public string Email { get; set; }
    public string Picture { get; set; }

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
}
