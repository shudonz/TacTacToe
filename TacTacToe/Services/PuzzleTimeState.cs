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

/// <summary>
/// Represents one jigsaw puzzle tile.
/// X/Y are normalized (0-1) coordinates of the piece's center on the play canvas.
/// Connectors is [top, right, bottom, left]: 1 = tab (protrusion), -1 = blank (notch), 0 = flat (border edge).
/// </summary>
public class PuzzleTile
{
    public string Id { get; set; } = "";
    /// <summary>Index in the correct solved layout (row * cols + col).</summary>
    public int CorrectIndex { get; set; }
    /// <summary>Normalized (0-1) horizontal center of this piece on the canvas.</summary>
    public double X { get; set; }
    /// <summary>Normalized (0-1) vertical center of this piece on the canvas.</summary>
    public double Y { get; set; }
    /// <summary>True when piece has been snapped to its correct position.</summary>
    public bool IsPlaced { get; set; }
    /// <summary>Emoji face assigned to this piece.</summary>
    public string Face { get; set; } = "";
    public string? LockedByConnectionId { get; set; }
    public string? LockedByName { get; set; }
    /// <summary>[top, right, bottom, left]: 1=tab, -1=blank, 0=flat.</summary>
    public int[] Connectors { get; set; } = [0, 0, 0, 0];
}

public static class PuzzleTimeEngine
{
    public const string DefaultImageKey = "emoji-garden";

    private static readonly Dictionary<string, string[]> PatternSets = new(StringComparer.OrdinalIgnoreCase)
    {
        ["emoji-garden"] = ["🌸", "🌼", "🌺", "🌻", "🌷", "🌹", "🍀", "🍃", "🦋", "🐝", "🌈", "☀️"],
        ["emoji-space"]  = ["🌙", "⭐", "✨", "☄️", "🪐", "🌌", "🚀", "🛰️", "👨‍🚀", "🌠", "🔭", "🛸"],
        ["emoji-ocean"]  = ["🌊", "🐠", "🐟", "🐡", "🐬", "🐳", "🪸", "🫧", "🦀", "🐙", "🐚", "🦑"],
        ["emoji-snacks"] = ["🍕", "🍔", "🌮", "🍣", "🍜", "🍩", "🍪", "🍉", "🍓", "🍇", "🥨", "🍿"]
    };

    public static IReadOnlyList<object> Catalog =>
    [
        new { Key = "emoji-garden", Name = "Emoji Garden" },
        new { Key = "emoji-space",  Name = "Space Quest"  },
        new { Key = "emoji-ocean",  Name = "Ocean Life"   },
        new { Key = "emoji-snacks", Name = "Snack Party"  }
    ];

    public static int NormalizePieceCount(int n) => n is 5 or 25 or 50 or 100 ? n : 25;

    public static (int Rows, int Cols) GridFor(int pieceCount)
    {
        return NormalizePieceCount(pieceCount) switch
        {
            5   => (1, 5),
            25  => (5, 5),
            50  => (5, 10),
            100 => (10, 10),
            _   => (5, 5)
        };
    }

    public static string NormalizeImageKey(string? key) =>
        !string.IsNullOrWhiteSpace(key) && PatternSets.ContainsKey(key) ? key : DefaultImageKey;

    // ---------------------------------------------------------------
    // Tile creation
    // ---------------------------------------------------------------

    public static List<PuzzleTile> CreateTiles(int pieceCount, string imageKey)
    {
        pieceCount = NormalizePieceCount(pieceCount);
        imageKey   = NormalizeImageKey(imageKey);
        var (rows, cols) = GridFor(pieceCount);

        // Build emoji faces for each grid position
        var faces = BuildFaces(pieceCount, imageKey);

        // Generate interlocking connector values.
        // hConn[r, c] = piece(r,c).Right = −piece(r,c+1).Left
        // vConn[r, c] = piece(r,c).Bottom = −piece(r+1,c).Top
        int[,] hConn = new int[rows, cols - 1];
        int[,] vConn = new int[rows - 1, cols];
        for (int r = 0; r < rows; r++)
            for (int c = 0; c < cols - 1; c++)
                hConn[r, c] = Random.Shared.Next(2) == 0 ? -1 : 1;
        for (int r = 0; r < rows - 1; r++)
            for (int c = 0; c < cols; c++)
                vConn[r, c] = Random.Shared.Next(2) == 0 ? -1 : 1;

        var tiles = new List<PuzzleTile>(pieceCount);
        for (int i = 0; i < pieceCount; i++)
        {
            int r = i / cols, c = i % cols;
            tiles.Add(new PuzzleTile
            {
                Id           = $"tile-{i}",
                CorrectIndex = i,
                Face         = faces[i],
                Connectors   =
                [
                    r > 0       ? -vConn[r - 1, c] : 0,  // top
                    c < cols-1  ?  hConn[r, c]     : 0,  // right
                    r < rows-1  ?  vConn[r, c]     : 0,  // bottom
                    c > 0       ? -hConn[r, c - 1] : 0   // left
                ]
            });
        }

        ScatterTiles(tiles, rows, cols);
        return tiles;
    }

    /// <summary>Spread tiles randomly across the canvas at start-of-game.</summary>
    private static void ScatterTiles(List<PuzzleTile> tiles, int rows, int cols)
    {
        // Use a shuffled grid layout with jitter so pieces are spread out and distinguishable.
        int total = tiles.Count;
        var slots = Enumerable.Range(0, total).OrderBy(_ => Random.Shared.Next()).ToList();
        for (int i = 0; i < total; i++)
        {
            int slot = slots[i];
            int sr = slot / cols, sc = slot % cols;
            double baseX = (sc + 0.5) / cols;
            double baseY = (sr + 0.5) / rows;
            // Add jitter within ±35 % of cell size
            double jitter = 0.35;
            double jx = (Random.Shared.NextDouble() * 2 - 1) * jitter / cols;
            double jy = (Random.Shared.NextDouble() * 2 - 1) * jitter / rows;
            tiles[i].X = Math.Clamp(baseX + jx, 0.04, 0.96);
            tiles[i].Y = Math.Clamp(baseY + jy, 0.04, 0.96);
        }
    }

    // ---------------------------------------------------------------
    // Position update with snap-to-correct
    // ---------------------------------------------------------------

    public static bool TrySetTilePosition(PuzzleTimeRoom room, string tileId, double x, double y, string connectionId)
    {
        var tile = room.Tiles.FirstOrDefault(t => t.Id == tileId);
        if (tile == null) return false;
        if (tile.LockedByConnectionId != connectionId) return false;

        x = Math.Clamp(x, 0.0, 1.0);
        y = Math.Clamp(y, 0.0, 1.0);

        var (rows, cols) = GridFor(room.Settings.PieceCount);
        int row = tile.CorrectIndex / cols;
        int col = tile.CorrectIndex % cols;

        double correctX = (col + 0.5) / cols;
        double correctY = (row + 0.5) / rows;

        // Snap if within ~65 % of one cell's half-width
        double snapThreshold = 0.65 / Math.Max(rows, cols);
        double dist = Math.Sqrt(Math.Pow(x - correctX, 2) + Math.Pow(y - correctY, 2));

        if (dist <= snapThreshold)
        {
            tile.X        = correctX;
            tile.Y        = correctY;
            tile.IsPlaced = true;
        }
        else
        {
            tile.X        = x;
            tile.Y        = y;
            tile.IsPlaced = false;
        }

        return true;
    }

    // ---------------------------------------------------------------
    // Lock helpers (unchanged)
    // ---------------------------------------------------------------

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
        if (tile == null || tile.LockedByConnectionId != connectionId) return;
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

    // ---------------------------------------------------------------
    // Win detection
    // ---------------------------------------------------------------

    public static bool IsSolved(PuzzleTimeRoom room) => room.Tiles.All(t => t.IsPlaced);

    // ---------------------------------------------------------------
    // Preview helper
    // ---------------------------------------------------------------

    public static List<string> BuildPreviewFaces(int pieceCount, string imageKey) =>
        BuildFaces(NormalizePieceCount(pieceCount), NormalizeImageKey(imageKey));

    private static List<string> BuildFaces(int pieceCount, string imageKey)
    {
        var palette = PatternSets[NormalizeImageKey(imageKey)];
        var (rows, cols) = GridFor(pieceCount);
        var cells = new List<string>(pieceCount);
        for (int r = 0; r < rows; r++)
            for (int c = 0; c < cols; c++)
                cells.Add(palette[(r * 3 + c * 5 + r * c) % palette.Length]);
        return cells;
    }
}
