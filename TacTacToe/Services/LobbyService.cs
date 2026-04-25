using System.Collections.Concurrent;

namespace TacTacToe.Services;

public class LobbyService
{
    private readonly ConcurrentDictionary<string, LobbyPlayer> _players = new();
    private readonly ConcurrentDictionary<string, GameState> _games = new();
    private readonly ConcurrentDictionary<string, YahtzeeRoom> _yahtzeeRooms = new();
    private readonly ConcurrentDictionary<string, TttRoom> _tttRooms = new();
    private readonly ConcurrentDictionary<string, SlotsRoom> _slotsRooms = new();
    private readonly ConcurrentDictionary<string, ConcentrationRoom> _concentrationRooms = new();
    private readonly ConcurrentDictionary<string, SolitaireRoom> _solitaireRooms = new();
    private readonly ConcurrentDictionary<string, PegSolitaireRoom> _pegSolitaireRooms = new();
    private readonly ConcurrentDictionary<string, ChineseCheckersRoom> _chineseCheckersRooms = new();
    private readonly ConcurrentDictionary<string, CrazyEightsRoom> _crazyEightsRooms = new();
    private readonly ConcurrentDictionary<string, PuzzleTimeRoom> _puzzleTimeRooms = new();
    private readonly ConcurrentDictionary<string, BattleBoatRoom> _battleBoatRooms = new();
    private readonly ConcurrentDictionary<string, BonesRoom> _bonesRooms = new();
    private readonly ConcurrentDictionary<string, MancalaRoom> _mancalaRooms = new();
    private readonly ConcurrentDictionary<string, FoxAndHoundsRoom> _foxAndHoundsRooms = new();

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

    private bool IsOnlineConnection(string connectionId) =>
        !string.IsNullOrWhiteSpace(connectionId) && _players.ContainsKey(connectionId);

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
        _tttRooms.Values.Where(r => !r.Started && !r.IsOver &&
            IsOnlineConnection(r.HostConnectionId));

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
        _yahtzeeRooms.Values.Where(r => !r.Settings.IsPrivate && !r.Started && !r.IsOver &&
            IsOnlineConnection(r.HostConnectionId) &&
            r.Players.Any(p => IsOnlineConnection(p.ConnectionId)));

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
        _slotsRooms.Values.Where(r => !r.Started && !r.IsOver &&
            IsOnlineConnection(r.HostConnectionId) &&
            r.Players.Any(p => p.IsBot || IsOnlineConnection(p.ConnectionId)));

    public IEnumerable<SlotsRoom> GetSlotsRoomsForConnection(string connectionId) =>
        _slotsRooms.Values.Where(r => !r.Started && r.Players.Any(p => p.ConnectionId == connectionId));

    public IEnumerable<SlotsRoom> GetActiveSlotsRoomsForConnection(string connectionId) =>
        _slotsRooms.Values.Where(r => r.Started && !r.IsOver &&
            r.Players.Any(p => p.ConnectionId == connectionId && !p.IsBot));

    public void RemoveSlotsRoom(string id) => _slotsRooms.TryRemove(id, out _);

    // --- Concentration Rooms ---

    public ConcentrationRoom CreateConcentrationRoom(string id, string hostConnectionId)
    {
        var host = _players.GetValueOrDefault(hostConnectionId);
        var room = new ConcentrationRoom
        {
            Id = id,
            HostConnectionId = hostConnectionId,
            HostName = host?.Name ?? "Host",
            Players = [new ConcentrationPlayer { ConnectionId = hostConnectionId, Name = host?.Name ?? "Host", Connected = true }]
        };
        _concentrationRooms[id] = room;
        return room;
    }

    public ConcentrationRoom? GetConcentrationRoom(string id)
    {
        _concentrationRooms.TryGetValue(id, out var r);
        return r;
    }

    public void StoreConcentrationRoom(string id, ConcentrationRoom room) => _concentrationRooms[id] = room;

    public IEnumerable<ConcentrationRoom> GetOpenConcentrationRooms() =>
        _concentrationRooms.Values.Where(r => !r.Started && !r.IsOver &&
            IsOnlineConnection(r.HostConnectionId) &&
            r.Players.Any(p => p.IsBot || IsOnlineConnection(p.ConnectionId)));

    public IEnumerable<ConcentrationRoom> GetConcentrationRoomsForConnection(string connectionId) =>
        _concentrationRooms.Values.Where(r => !r.Started && r.Players.Any(p => p.ConnectionId == connectionId));

    public IEnumerable<ConcentrationRoom> GetActiveConcentrationRoomsForConnection(string connectionId) =>
        _concentrationRooms.Values.Where(r => r.Started && !r.IsOver &&
            r.Players.Any(p => p.ConnectionId == connectionId && !p.IsBot));

    public void RemoveConcentrationRoom(string id) => _concentrationRooms.TryRemove(id, out _);

    // --- Solitaire Rooms ---

    public SolitaireRoom CreateSolitaireRoom(string id, string hostConnectionId)
    {
        var host = _players.GetValueOrDefault(hostConnectionId);
        var room = new SolitaireRoom
        {
            Id = id,
            HostConnectionId = hostConnectionId,
            HostName = host?.Name ?? "Host",
            Players = [new SolitairePlayer { ConnectionId = hostConnectionId, Name = host?.Name ?? "Host", Connected = true }]
        };
        _solitaireRooms[id] = room;
        return room;
    }

    public SolitaireRoom? GetSolitaireRoom(string id) { _solitaireRooms.TryGetValue(id, out var r); return r; }
    public void StoreSolitaireRoom(string id, SolitaireRoom room) => _solitaireRooms[id] = room;

    public IEnumerable<SolitaireRoom> GetOpenSolitaireRooms() =>
        _solitaireRooms.Values.Where(r => !r.Started && !r.IsOver &&
            IsOnlineConnection(r.HostConnectionId) &&
            r.Players.Any(p => p.IsBot || IsOnlineConnection(p.ConnectionId)));

    public IEnumerable<SolitaireRoom> GetSolitaireRoomsForConnection(string connectionId) =>
        _solitaireRooms.Values.Where(r => !r.Started && r.Players.Any(p => p.ConnectionId == connectionId));

    public IEnumerable<SolitaireRoom> GetActiveSolitaireRoomsForConnection(string connectionId) =>
        _solitaireRooms.Values.Where(r => r.Started && !r.IsOver &&
            r.Players.Any(p => p.ConnectionId == connectionId && !p.IsBot));

    public void RemoveSolitaireRoom(string id) => _solitaireRooms.TryRemove(id, out _);

    // --- Peg Solitaire Rooms ---

    public PegSolitaireRoom CreatePegSolitaireRoom(string id, string hostConnectionId)
    {
        var host = _players.GetValueOrDefault(hostConnectionId);
        var room = new PegSolitaireRoom
        {
            Id = id,
            HostConnectionId = hostConnectionId,
            HostName = host?.Name ?? "Host",
            Players = [new PegSolitairePlayer { ConnectionId = hostConnectionId, Name = host?.Name ?? "Host", Connected = true }]
        };
        _pegSolitaireRooms[id] = room;
        return room;
    }

    public PegSolitaireRoom? GetPegSolitaireRoom(string id) { _pegSolitaireRooms.TryGetValue(id, out var r); return r; }
    public void StorePegSolitaireRoom(string id, PegSolitaireRoom room) => _pegSolitaireRooms[id] = room;

    public IEnumerable<PegSolitaireRoom> GetOpenPegSolitaireRooms() =>
        _pegSolitaireRooms.Values.Where(r => !r.Started && !r.IsOver &&
            IsOnlineConnection(r.HostConnectionId) &&
            r.Players.Any(p => p.IsBot || IsOnlineConnection(p.ConnectionId)));

    public IEnumerable<PegSolitaireRoom> GetPegSolitaireRoomsForConnection(string connectionId) =>
        _pegSolitaireRooms.Values.Where(r => !r.Started && r.Players.Any(p => p.ConnectionId == connectionId));

    public IEnumerable<PegSolitaireRoom> GetActivePegSolitaireRoomsForConnection(string connectionId) =>
        _pegSolitaireRooms.Values.Where(r => r.Started && !r.IsOver &&
            r.Players.Any(p => p.ConnectionId == connectionId && !p.IsBot));

    public void RemovePegSolitaireRoom(string id) => _pegSolitaireRooms.TryRemove(id, out _);

    // --- Chinese Checkers Rooms ---

    public ChineseCheckersRoom CreateChineseCheckersRoom(string id, string hostConnectionId)
    {
        var host = _players.GetValueOrDefault(hostConnectionId);
        var room = new ChineseCheckersRoom
        {
            Id = id,
            HostConnectionId = hostConnectionId,
            HostName = host?.Name ?? "Host",
            Players = [new ChineseCheckersPlayer { ConnectionId = hostConnectionId, Name = host?.Name ?? "Host", Connected = true }]
        };
        _chineseCheckersRooms[id] = room;
        return room;
    }

    public ChineseCheckersRoom? GetChineseCheckersRoom(string id) { _chineseCheckersRooms.TryGetValue(id, out var r); return r; }
    public void StoreChineseCheckersRoom(string id, ChineseCheckersRoom room) => _chineseCheckersRooms[id] = room;

    public IEnumerable<ChineseCheckersRoom> GetOpenChineseCheckersRooms() =>
        _chineseCheckersRooms.Values.Where(r => !r.Started && !r.IsOver &&
            IsOnlineConnection(r.HostConnectionId) &&
            r.Players.Any(p => p.IsBot || IsOnlineConnection(p.ConnectionId)));

    public IEnumerable<ChineseCheckersRoom> GetChineseCheckersRoomsForConnection(string connectionId) =>
        _chineseCheckersRooms.Values.Where(r => !r.Started && r.Players.Any(p => p.ConnectionId == connectionId));

    public IEnumerable<ChineseCheckersRoom> GetActiveChineseCheckersRoomsForConnection(string connectionId) =>
        _chineseCheckersRooms.Values.Where(r => r.Started && !r.IsOver &&
            r.Players.Any(p => p.ConnectionId == connectionId && !p.IsBot));

    public void RemoveChineseCheckersRoom(string id) => _chineseCheckersRooms.TryRemove(id, out _);

    // --- Crazy Eights Rooms ---

    public CrazyEightsRoom CreateCrazyEightsRoom(string id, string hostConnectionId)
    {
        var host = _players.GetValueOrDefault(hostConnectionId);
        var room = new CrazyEightsRoom
        {
            Id = id,
            HostConnectionId = hostConnectionId,
            HostName = host?.Name ?? "Host",
            Players = [new CrazyEightsPlayer { ConnectionId = hostConnectionId, Name = host?.Name ?? "Host", Connected = true }]
        };
        _crazyEightsRooms[id] = room;
        return room;
    }

    public CrazyEightsRoom? GetCrazyEightsRoom(string id) { _crazyEightsRooms.TryGetValue(id, out var r); return r; }
    public void StoreCrazyEightsRoom(string id, CrazyEightsRoom room) => _crazyEightsRooms[id] = room;

    public IEnumerable<CrazyEightsRoom> GetOpenCrazyEightsRooms() =>
        _crazyEightsRooms.Values.Where(r => !r.Started && !r.IsOver &&
            IsOnlineConnection(r.HostConnectionId) &&
            r.Players.Any(p => p.IsBot || IsOnlineConnection(p.ConnectionId)));

    public IEnumerable<CrazyEightsRoom> GetCrazyEightsRoomsForConnection(string connectionId) =>
        _crazyEightsRooms.Values.Where(r => !r.Started && r.Players.Any(p => p.ConnectionId == connectionId));

    public IEnumerable<CrazyEightsRoom> GetActiveCrazyEightsRoomsForConnection(string connectionId) =>
        _crazyEightsRooms.Values.Where(r => r.Started && !r.IsOver &&
            r.Players.Any(p => p.ConnectionId == connectionId && !p.IsBot));

    public void RemoveCrazyEightsRoom(string id) => _crazyEightsRooms.TryRemove(id, out _);

    // --- Puzzle Time Rooms ---

    public PuzzleTimeRoom CreatePuzzleTimeRoom(string id, string hostConnectionId)
    {
        var host = _players.GetValueOrDefault(hostConnectionId);
        var room = new PuzzleTimeRoom
        {
            Id = id,
            HostConnectionId = hostConnectionId,
            HostName = host?.Name ?? "Host",
            Players = [new PuzzleTimePlayer { ConnectionId = hostConnectionId, Name = host?.Name ?? "Host", Connected = true }]
        };
        _puzzleTimeRooms[id] = room;
        return room;
    }

    public PuzzleTimeRoom? GetPuzzleTimeRoom(string id) { _puzzleTimeRooms.TryGetValue(id, out var r); return r; }
    public void StorePuzzleTimeRoom(string id, PuzzleTimeRoom room) => _puzzleTimeRooms[id] = room;

    public IEnumerable<PuzzleTimeRoom> GetOpenPuzzleTimeRooms() =>
        _puzzleTimeRooms.Values.Where(r => !r.Started && !r.IsOver &&
            IsOnlineConnection(r.HostConnectionId) &&
            r.Players.Any(p => p.IsBot || IsOnlineConnection(p.ConnectionId)));

    public IEnumerable<PuzzleTimeRoom> GetPuzzleTimeRoomsForConnection(string connectionId) =>
        _puzzleTimeRooms.Values.Where(r => !r.Started && r.Players.Any(p => p.ConnectionId == connectionId));

    public IEnumerable<PuzzleTimeRoom> GetActivePuzzleTimeRoomsForConnection(string connectionId) =>
        _puzzleTimeRooms.Values.Where(r => r.Started && !r.IsOver &&
            r.Players.Any(p => p.ConnectionId == connectionId && !p.IsBot));

    public void RemovePuzzleTimeRoom(string id) => _puzzleTimeRooms.TryRemove(id, out _);

    // --- Battle Boat Rooms ---

    public BattleBoatRoom CreateBattleBoatRoom(string id, string hostConnectionId)
    {
        var host = _players.GetValueOrDefault(hostConnectionId);
        var room = new BattleBoatRoom
        {
            Id = id,
            HostConnectionId = hostConnectionId,
            HostName = host?.Name ?? "Host",
            Players = [new BattleBoatPlayer { ConnectionId = hostConnectionId, Name = host?.Name ?? "Host", Connected = true }]
        };
        _battleBoatRooms[id] = room;
        return room;
    }

    public BattleBoatRoom? GetBattleBoatRoom(string id) { _battleBoatRooms.TryGetValue(id, out var r); return r; }
    public void StoreBattleBoatRoom(string id, BattleBoatRoom room) => _battleBoatRooms[id] = room;

    public IEnumerable<BattleBoatRoom> GetOpenBattleBoatRooms() =>
        _battleBoatRooms.Values.Where(r => !r.Started && !r.IsOver &&
            IsOnlineConnection(r.HostConnectionId) &&
            r.Players.Any(p => IsOnlineConnection(p.ConnectionId)));

    public IEnumerable<BattleBoatRoom> GetBattleBoatRoomsForConnection(string connectionId) =>
        _battleBoatRooms.Values.Where(r => !r.Started && r.Players.Any(p => p.ConnectionId == connectionId));

    public IEnumerable<BattleBoatRoom> GetActiveBattleBoatRoomsForConnection(string connectionId) =>
        _battleBoatRooms.Values.Where(r => r.Started && !r.IsOver &&
            r.Players.Any(p => p.ConnectionId == connectionId));

    public void RemoveBattleBoatRoom(string id) => _battleBoatRooms.TryRemove(id, out _);

    // --- Bones Rooms ---

    public BonesRoom CreateBonesRoom(string id, string hostConnectionId)
    {
        var host = _players.GetValueOrDefault(hostConnectionId);
        var room = new BonesRoom
        {
            Id = id,
            HostConnectionId = hostConnectionId,
            HostName = host?.Name ?? "Host",
            Players = [new BonesPlayer { ConnectionId = hostConnectionId, Name = host?.Name ?? "Host", Connected = true }]
        };
        _bonesRooms[id] = room;
        return room;
    }

    public BonesRoom? GetBonesRoom(string id) { _bonesRooms.TryGetValue(id, out var r); return r; }
    public void StoreBonesRoom(string id, BonesRoom room) => _bonesRooms[id] = room;

    public IEnumerable<BonesRoom> GetOpenBonesRooms() =>
        _bonesRooms.Values.Where(r => !r.Started && !r.IsOver &&
            IsOnlineConnection(r.HostConnectionId) &&
            r.Players.Any(p => p.IsBot || IsOnlineConnection(p.ConnectionId)));

    public IEnumerable<BonesRoom> GetBonesRoomsForConnection(string connectionId) =>
        _bonesRooms.Values.Where(r => !r.Started && r.Players.Any(p => p.ConnectionId == connectionId));

    public IEnumerable<BonesRoom> GetActiveBonesRoomsForConnection(string connectionId) =>
        _bonesRooms.Values.Where(r => r.Started && !r.IsOver &&
            r.Players.Any(p => p.ConnectionId == connectionId && !p.IsBot));

    public void RemoveBonesRoom(string id) => _bonesRooms.TryRemove(id, out _);

    // --- Mancala Rooms ---

    public MancalaRoom CreateMancalaRoom(string id, string hostConnectionId)
    {
        var host = _players.GetValueOrDefault(hostConnectionId);
        var room = new MancalaRoom
    // --- Fox and Hounds Rooms ---

    public FoxAndHoundsRoom CreateFoxAndHoundsRoom(string id, string hostConnectionId)
    {
        var host = _players.GetValueOrDefault(hostConnectionId);
        var room = new FoxAndHoundsRoom
        {
            Id = id,
            HostConnectionId = hostConnectionId,
            HostName = host?.Name ?? "Host",
            Players = [new MancalaPlayer { ConnectionId = hostConnectionId, Name = host?.Name ?? "Host", Connected = true }]
        };
        _mancalaRooms[id] = room;
        return room;
    }

    public MancalaRoom? GetMancalaRoom(string id) { _mancalaRooms.TryGetValue(id, out var r); return r; }
    public void StoreMancalaRoom(string id, MancalaRoom room) => _mancalaRooms[id] = room;

    public IEnumerable<MancalaRoom> GetOpenMancalaRooms() =>
        _mancalaRooms.Values.Where(r => !r.Started && !r.IsOver &&
            IsOnlineConnection(r.HostConnectionId) &&
            r.Players.Any(p => p.IsBot || IsOnlineConnection(p.ConnectionId)));

    public IEnumerable<MancalaRoom> GetMancalaRoomsForConnection(string connectionId) =>
        _mancalaRooms.Values.Where(r => !r.Started && r.Players.Any(p => p.ConnectionId == connectionId));

    public IEnumerable<MancalaRoom> GetActiveMancalaRoomsForConnection(string connectionId) =>
        _mancalaRooms.Values.Where(r => r.Started && !r.IsOver &&
            r.Players.Any(p => p.ConnectionId == connectionId && !p.IsBot));

    public void RemoveMancalaRoom(string id) => _mancalaRooms.TryRemove(id, out _);
            Players = [new FoxAndHoundsPlayer { ConnectionId = hostConnectionId, Name = host?.Name ?? "Host", Connected = true }]
        };
        _foxAndHoundsRooms[id] = room;
        return room;
    }

    public FoxAndHoundsRoom? GetFoxAndHoundsRoom(string id) { _foxAndHoundsRooms.TryGetValue(id, out var r); return r; }
    public void StoreFoxAndHoundsRoom(string id, FoxAndHoundsRoom room) => _foxAndHoundsRooms[id] = room;

    public IEnumerable<FoxAndHoundsRoom> GetOpenFoxAndHoundsRooms() =>
        _foxAndHoundsRooms.Values.Where(r => !r.Started && !r.IsOver &&
            IsOnlineConnection(r.HostConnectionId) &&
            r.Players.Any(p => p.IsBot || IsOnlineConnection(p.ConnectionId)));

    public IEnumerable<FoxAndHoundsRoom> GetFoxAndHoundsRoomsForConnection(string connectionId) =>
        _foxAndHoundsRooms.Values.Where(r => !r.Started && r.Players.Any(p => p.ConnectionId == connectionId));

    public IEnumerable<FoxAndHoundsRoom> GetActiveFoxAndHoundsRoomsForConnection(string connectionId) =>
        _foxAndHoundsRooms.Values.Where(r => r.Started && !r.IsOver &&
            r.Players.Any(p => p.ConnectionId == connectionId && !p.IsBot));

    public void RemoveFoxAndHoundsRoom(string id) => _foxAndHoundsRooms.TryRemove(id, out _);
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
    public long StartedAtMs { get; set; }
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
