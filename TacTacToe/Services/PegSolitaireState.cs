namespace TacTacToe.Services;

public class PegSolitaireRoom
{
    public string Id { get; set; } = "";
    public string HostConnectionId { get; set; } = "";
    public string HostName { get; set; } = "";
    public List<PegSolitairePlayer> Players { get; set; } = [];
    public bool Started { get; set; }
    public bool IsOver { get; set; }
    public bool IsSinglePlayer { get; set; }
    public PegSolitaireSettings Settings { get; set; } = new();
    public int FinishCount { get; set; }
}

public class PegSolitaireSettings
{
    public string RoomName { get; set; } = "Peg Solitaire Room";
    public int MaxPlayers { get; set; } = 4;
    public int EmptyStartIndex { get; set; } = 0;
}

public class PegSolitairePlayer
{
    public string ConnectionId { get; set; } = "";
    public string Name { get; set; } = "";
    public bool Connected { get; set; } = true;
    public bool IsBot { get; set; }
    public PegSolitaireGameState Game { get; set; } = new();
    public int Score { get; set; }
    public int PegsLeft { get; set; } = 15;
    public string Rating { get; set; } = "Try Again";
    public bool HasFinished { get; set; }
    public int FinishRank { get; set; }
    public long StartedAtMs { get; set; }
    public long FinishedAtMs { get; set; }
    public bool SessionSaved { get; set; }
}

public class PegSolitaireGameState
{
    public bool[] Pegs { get; set; } = new bool[15];
    public int MoveCount { get; set; }
    public bool HasMoves { get; set; } = true;
    public bool IsSetup { get; set; } = true;
}

public static class PegSolitaireEngine
{
    public readonly record struct PegMove(int From, int Over, int To);

    private static readonly PegMove[] _moves = BuildMoves();
    public static IReadOnlyList<PegMove> Moves => _moves;

    public static PegSolitaireGameState CreateInitialState(int emptyIndex = 0)
    {
        var g = new PegSolitaireGameState();
        for (int i = 0; i < g.Pegs.Length; i++) g.Pegs[i] = true;
        // All 15 pegs filled — player must click one to remove it before play begins
        g.MoveCount = 0;
        g.IsSetup = true;
        g.HasMoves = false;
        return g;
    }

    public static void SetStartEmpty(PegSolitaireGameState game, int index)
    {
        index = Math.Clamp(index, 0, 14);
        game.Pegs[index] = false;
        game.IsSetup = false;
        game.HasMoves = HasAnyMoves(game);
    }

    public static bool TryMove(PegSolitaireGameState game, int from, int to)
    {
        if (game.Pegs.Length != 15) return false;
        if (from < 0 || from >= 15 || to < 0 || to >= 15) return false;
        if (!game.Pegs[from] || game.Pegs[to]) return false;

        foreach (var m in _moves)
        {
            if (m.From != from || m.To != to) continue;
            if (!game.Pegs[m.Over]) return false;
            game.Pegs[m.From] = false;
            game.Pegs[m.Over] = false;
            game.Pegs[m.To] = true;
            game.MoveCount++;
            game.HasMoves = HasAnyMoves(game);
            return true;
        }

        return false;
    }

    public static bool HasAnyMoves(PegSolitaireGameState game) =>
        _moves.Any(m => game.Pegs[m.From] && game.Pegs[m.Over] && !game.Pegs[m.To]);

    public static int CountPegs(PegSolitaireGameState game) => game.Pegs.Count(p => p);

    public static string RatingFor(int pegsLeft) => pegsLeft switch
    {
        <= 1 => "Genius",
        2 => "Smart",
        3 => "Average",
        _ => "Try Again"
    };

    private static PegMove[] BuildMoves()
    {
        var dirs = new (int dr, int dc)[]
        {
            (-1, -1), (-1, 0),
            (0, -1),  (0, 1),
            (1, 0),   (1, 1)
        };

        var moves = new List<PegMove>();

        for (int r = 0; r < 5; r++)
        {
            for (int c = 0; c <= r; c++)
            {
                int from = ToIndex(r, c);
                foreach (var (dr, dc) in dirs)
                {
                    int r1 = r + dr, c1 = c + dc;
                    int r2 = r + (2 * dr), c2 = c + (2 * dc);
                    if (!IsValid(r1, c1) || !IsValid(r2, c2)) continue;
                    moves.Add(new PegMove(from, ToIndex(r1, c1), ToIndex(r2, c2)));
                }
            }
        }

        return moves
            .DistinctBy(m => (m.From, m.Over, m.To))
            .ToArray();
    }

    private static int ToIndex(int r, int c) => (r * (r + 1) / 2) + c;
    private static bool IsValid(int r, int c) => r >= 0 && r < 5 && c >= 0 && c <= r;
}
