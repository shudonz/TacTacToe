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
    public int[] Reels { get; set; } = [-1, -1, -1]; // -1 = not yet spun this round
    public int LastWin { get; set; }
    public bool HasSpun { get; set; }
    public bool IsBot { get; set; }
    public bool Connected { get; set; } = true;
}

/* ================================================================
   Slots Engine — reel logic & payout table
   ================================================================ */
public static class SlotsEngine
{
    // Symbols:  0=🍒Cherry  1=🍋Lemon  2=🍊Orange  3=🍇Grape
    //           4=🔔Bell    5=⭐Star   6=💎Diamond  7=7️⃣Seven
    private static readonly int[] Weights = [30, 25, 20, 15, 10, 6, 3, 1]; // total = 110

    public static int[] SpinReels() => [Pick(), Pick(), Pick()];

    private static int Pick()
    {
        int total = Weights.Sum();
        int r = Random.Shared.Next(total);
        for (int i = 0; i < Weights.Length; i++) { r -= Weights[i]; if (r < 0) return i; }
        return 0;
    }

    public static int CalculatePayout(int[] reels, int bet)
    {
        int a = reels[0], b = reels[1], c = reels[2];

        // Three of a kind
        if (a == b && b == c)
            return bet * (a switch { 7 => 100, 6 => 50, 5 => 20, 4 => 10, 3 => 8, 2 => 6, 1 => 4, 0 => 3, _ => 0 });

        // Two cherries in first two reels
        if (a == 0 && b == 0) return bet * 2;

        // Single cherry on first reel
        if (a == 0) return bet;

        return 0;
    }

    public static string GetWinLabel(int[] reels)
    {
        int a = reels[0], b = reels[1], c = reels[2];
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
        if (a == 0 && b == 0) return "🍒🍒 Two Cherries";
        if (a == 0) return "🍒 Cherry";
        return "";
    }
}
