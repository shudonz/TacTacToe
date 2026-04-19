namespace TacTacToe.Services;

/* ================================================================
   Slots — Vegas-style slot machine, 2-4 players or single player
   ================================================================ */

public class SlotsRoom
{
    public string Id { get; set; } = "";
    public string HostConnectionId { get; set; } = "";
    public string HostName { get; set; } = "";
    public List<SlotsPlayer> Players { get; set; } = [];
    public bool Started { get; set; }
    public bool IsOver { get; set; }
    public string? WinnerName { get; set; }
    public bool IsSinglePlayer { get; set; }
    public SlotsSettings Settings { get; set; } = new();
    public int RoundsPlayed { get; set; }
    public SlotsPhase Phase { get; set; } = SlotsPhase.Betting;
}

public enum SlotsPhase { Betting, Results }

public class SlotsSettings
{
    public string RoomName { get; set; } = "Slots Room";
    public int MaxPlayers { get; set; } = 4;
    public int StartingBalance { get; set; } = 1000;
    public int TotalRounds { get; set; } = 10;
}

public class SlotsPlayer
{
    public string ConnectionId { get; set; } = "";
    public string Name { get; set; } = "";
    public int Balance { get; set; } = 1000;
    public int CurrentBet { get; set; }
    public int BetPerLine { get; set; }
    public int ActivePaylines { get; set; }
    public int[][] Reels { get; set; } = SlotsEngine.UnspunReels(); // -1 = not yet spun this round
    public int LastWin { get; set; }
    public List<int> WinningPaylines { get; set; } = [];
    public int TotalMultiplier { get; set; }
    public bool HasSpun { get; set; }
    public bool IsBot { get; set; }
    public bool Connected { get; set; } = true;
}

public sealed class SlotsSpinResult
{
    public int Payout { get; init; }
    public List<int> WinningPaylines { get; init; } = [];
    public int TotalMultiplier { get; init; }
}

/* ================================================================
   Slots Engine — reel logic & payout table
   ================================================================ */
public static class SlotsEngine
{
    public const int Rows = 3;
    public const int Cols = 3;
    public const int MaxPaylines = 5;

    // Symbols:  0=🍒Cherry  1=🍋Lemon  2=🍊Orange  3=🍇Grape
    //           4=🔔Bell    5=⭐Star   6=💎Diamond  7=7️⃣Seven
    private static readonly int[] Weights = [30, 25, 20, 15, 10, 6, 3, 1]; // total = 110

    private static readonly (int Row, int Col)[][] Paylines =
    [
        [(0, 0), (0, 1), (0, 2)], // Top
        [(1, 0), (1, 1), (1, 2)], // Middle
        [(2, 0), (2, 1), (2, 2)], // Bottom
        [(0, 0), (1, 1), (2, 2)], // Diagonal down
        [(2, 0), (1, 1), (0, 2)]  // Diagonal up
    ];

    public static int[][] SpinReels()
    {
        var reels = new int[Rows][];
        for (int r = 0; r < Rows; r++)
        {
            reels[r] = new int[Cols];
            for (int c = 0; c < Cols; c++) reels[r][c] = Pick();
        }
        return reels;
    }

    public static int[][] UnspunReels()
    {
        var reels = new int[Rows][];
        for (int r = 0; r < Rows; r++) reels[r] = Enumerable.Repeat(-1, Cols).ToArray();
        return reels;
    }

    private static int Pick()
    {
        int total = Weights.Sum();
        int r = Random.Shared.Next(total);
        for (int i = 0; i < Weights.Length; i++) { r -= Weights[i]; if (r < 0) return i; }
        return 0;
    }

    public static SlotsSpinResult EvaluateSpin(int[][] reels, int betPerLine, int activePaylines)
    {
        int lines = Math.Clamp(activePaylines, 1, MaxPaylines);
        int lineBet = Math.Max(1, betPerLine);

        int payout = 0;
        int totalMultiplier = 0;
        var wins = new List<int>();

        for (int i = 0; i < lines; i++)
        {
            var symbols = Paylines[i].Select(p => reels[p.Row][p.Col]).ToArray();
            int mult = CalculateLineMultiplier(symbols);
            if (mult <= 0) continue;
            payout += lineBet * mult;
            totalMultiplier += mult;
            wins.Add(i);
        }

        return new SlotsSpinResult
        {
            Payout = payout,
            WinningPaylines = wins,
            TotalMultiplier = totalMultiplier
        };
    }

    private static int CalculateLineMultiplier(int[] line)
    {
        int a = line[0], b = line[1], c = line[2];

        // Three of a kind
        if (a == b && b == c)
            return a switch { 7 => 100, 6 => 50, 5 => 20, 4 => 10, 3 => 8, 2 => 6, 1 => 4, 0 => 3, _ => 0 };

        // Cherry fallback wins on a line (any position)
        int cherries = line.Count(s => s == 0);
        return cherries switch
        {
            >= 2 => 2,
            1 => 1,
            _ => 0
        };
    }

    public static string GetWinLabel(int[][] reels, int preferredLine = 1)
    {
        var coords = Paylines[Math.Clamp(preferredLine, 0, Paylines.Length - 1)];

        var line = coords.Select(p => reels[p.Row][p.Col]).ToArray();
        int a = line[0], b = line[1], c = line[2];
        if (a == b && b == c)
            return a switch
            {
                7 => "🎰 JACKPOT!",
                6 => "💎 DIAMONDS!",
                5 => "⭐ STARS!",
                4 => "🔔 BELLS!",
                3 => "🍇 GRAPES!",
                2 => "🍊 ORANGES!",
                1 => "🍋 LEMONS!",
                0 => "🍒 CHERRIES!",
                _ => "WIN!"
            };

        int cherries = line.Count(s => s == 0);
        if (cherries >= 2) return "🍒🍒 Double Cherry";
        if (cherries == 1) return "🍒 Cherry";
        return "";
    }
}
