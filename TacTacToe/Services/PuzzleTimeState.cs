namespace TacTacToe.Services;

public class PuzzleTimeRoom
{
    public string Id { get; set; } = "";
    public string HostConnectionId { get; set; } = "";
    public string HostName { get; set; } = "";
    public List<PuzzleTimePlayer> Players { get; set; } = [];
    public PuzzleTimeSettings Settings { get; set; } = new();
    public bool Started { get; set; }
    public bool IsOver { get; set; }
    public bool IsSinglePlayer { get; set; }
    public string? WinnerName { get; set; }
    public long StartedAtMs { get; set; }
    public bool SessionsSaved { get; set; }
    public List<PuzzleTile> Tiles { get; set; } = [];
}

public class PuzzleTimeSettings
{
    public string RoomName { get; set; } = "Puzzle Time Room";
    public int MaxPlayers { get; set; } = 4;
    public int PieceCount { get; set; } = 25;
    public string ImageKey { get; set; } = PuzzleTimeEngine.DefaultImageKey;
}

public class PuzzleTimePlayer
{
    public string ConnectionId { get; set; } = "";
    public string Name { get; set; } = "";
    public bool Connected { get; set; } = true;
    public bool IsBot { get; set; }
}

public class PuzzleTile
{
    public string Id { get; set; } = "";
    public int CorrectIndex { get; set; }
    public int CurrentIndex { get; set; }
    public int Rotation { get; set; }
    public string Face { get; set; } = "";
    public string? LockedByConnectionId { get; set; }
    public string? LockedByName { get; set; }
}

public static class PuzzleTimeEngine
{
    public const string DefaultImageKey = "emoji-garden";

    private static readonly Dictionary<string, string[]> PatternSets = new(StringComparer.OrdinalIgnoreCase)
    {
        ["emoji-garden"] = ["🌸", "🌼", "🌺", "🌻", "🌷", "🪻", "🍀", "🍃", "��", "🐝", "🌈", "☀️"],
        ["emoji-space"] = ["🌙", "⭐", "✨", "☄️", "🪐", "🌌", "🚀", "🛰️", "👨‍🚀", "🌠", "🔭", "🛸"],
        ["emoji-ocean"] = ["🌊", "🐠", "🐟", "🐡", "🐬", "🐳", "🪸", "🫧", "🦀", "🐙", "🐚", "🦑"],
        ["emoji-snacks"] = ["🍕", "🍔", "🌮", "🍣", "🍜", "🍩", "🍪", "🍉", "🍓", "🍇", "🥨", "🍿"]
    };

    public static IReadOnlyList<object> Catalog =>
        [
            new { Key = "emoji-garden", Name = "Emoji Garden" },
            new { Key = "emoji-space", Name = "Space Quest" },
            new { Key = "emoji-ocean", Name = "Ocean Life" },
            new { Key = "emoji-snacks", Name = "Snack Party" }
        ];

    public static int NormalizePieceCount(int pieceCount) => pieceCount is 5 or 25 or 50 or 100 ? pieceCount : 25;

    public static (int Rows, int Cols) GridFor(int pieceCount)
    {
        pieceCount = NormalizePieceCount(pieceCount);
        return pieceCount switch
        {
            5 => (1, 5),
            25 => (5, 5),
            50 => (5, 10),
            100 => (10, 10),
            _ => (5, 5)
        };
    }

    public static string NormalizeImageKey(string? key)
    {
        if (!string.IsNullOrWhiteSpace(key) && PatternSets.ContainsKey(key)) return key;
        return DefaultImageKey;
    }

    public static List<PuzzleTile> CreateTiles(int pieceCount, string imageKey)
    {
        pieceCount = NormalizePieceCount(pieceCount);
        imageKey = NormalizeImageKey(imageKey);

        var faces = BuildFaces(pieceCount, imageKey);
        var positions = Enumerable.Range(0, pieceCount).OrderBy(_ => Random.Shared.Next()).ToList();

        var tiles = new List<PuzzleTile>(pieceCount);
        for (int i = 0; i < pieceCount; i++)
        {
            tiles.Add(new PuzzleTile
            {
                Id = $"tile-{i}",
                CorrectIndex = i,
                CurrentIndex = positions[i],
                Rotation = Random.Shared.Next(0, 4),
                Face = faces[i]
            });
        }

        if (tiles.All(t => t.CorrectIndex == t.CurrentIndex && t.Rotation == 0) && tiles.Count > 1)
            (tiles[0].CurrentIndex, tiles[1].CurrentIndex) = (tiles[1].CurrentIndex, tiles[0].CurrentIndex);

        return tiles;
    }

    public static List<string> BuildPreviewFaces(int pieceCount, string imageKey) => BuildFaces(NormalizePieceCount(pieceCount), NormalizeImageKey(imageKey));

    private static List<string> BuildFaces(int pieceCount, string imageKey)
    {
        var palette = PatternSets[NormalizeImageKey(imageKey)];
        var (rows, cols) = GridFor(pieceCount);
        var cells = new List<string>(pieceCount);

        for (int r = 0; r < rows; r++)
        {
            for (int c = 0; c < cols; c++)
            {
                var idx = (r * 3 + c * 5 + r * c) % palette.Length;
                cells.Add(palette[idx]);
            }
        }

        return cells;
    }

    public static bool TryLockTile(PuzzleTimeRoom room, string tileId, string connectionId, string name)
    {
        var tile = room.Tiles.FirstOrDefault(t => t.Id == tileId);
        if (tile == null) return false;

        if (tile.LockedByConnectionId == null || tile.LockedByConnectionId == connectionId)
        {
            tile.LockedByConnectionId = connectionId;
            tile.LockedByName = name;
            return true;
        }

        return false;
    }

    public static void ReleaseTileLock(PuzzleTimeRoom room, string tileId, string connectionId)
    {
        var tile = room.Tiles.FirstOrDefault(t => t.Id == tileId);
        if (tile == null) return;
        if (tile.LockedByConnectionId != connectionId) return;
        tile.LockedByConnectionId = null;
        tile.LockedByName = null;
    }

    public static void ReleaseLocksForConnection(PuzzleTimeRoom room, string connectionId)
    {
        foreach (var tile in room.Tiles.Where(t => t.LockedByConnectionId == connectionId))
        {
            tile.LockedByConnectionId = null;
            tile.LockedByName = null;
        }
    }

    public static bool TryMoveTile(PuzzleTimeRoom room, string tileId, int targetIndex, string connectionId)
    {
        if (targetIndex < 0 || targetIndex >= room.Tiles.Count) return false;

        var tile = room.Tiles.FirstOrDefault(t => t.Id == tileId);
        if (tile == null) return false;
        if (tile.LockedByConnectionId != connectionId) return false;

        var other = room.Tiles.FirstOrDefault(t => t.CurrentIndex == targetIndex);
        if (other != null) other.CurrentIndex = tile.CurrentIndex;
        tile.CurrentIndex = targetIndex;
        return true;
    }

    public static bool TryRotateTile(PuzzleTimeRoom room, string tileId, bool clockwise, string connectionId)
    {
        var tile = room.Tiles.FirstOrDefault(t => t.Id == tileId);
        if (tile == null) return false;
        if (tile.LockedByConnectionId != connectionId) return false;

        tile.Rotation = clockwise
            ? (tile.Rotation + 1) % 4
            : (tile.Rotation + 3) % 4;

        return true;
    }

    public static bool IsSolved(PuzzleTimeRoom room) => room.Tiles.All(t => t.CurrentIndex == t.CorrectIndex && t.Rotation == 0);
}
