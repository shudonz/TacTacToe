namespace TacTacToe.Services;

/* ================================================================
   Yahtzee Room — supports 2-20 players with host-controlled lobby
   ================================================================ */

public class YahtzeeRoom
{
    public string Id { get; set; } = "";
    public string HostConnectionId { get; set; } = "";
    public string HostName { get; set; } = "";
    public List<YahtzeePlayer> Players { get; set; } = [];
    public bool Started { get; set; }
    public bool IsSinglePlayer { get; set; }
    public YahtzeeSettings Settings { get; set; } = new();

    // --- Live game state (populated once Started == true) ---
    public int CurrentPlayerIndex { get; set; }
    public int[] Dice { get; set; } = new int[5];
    public bool[] Held { get; set; } = new bool[5];
    public int RollsLeft { get; set; } = 3;
    public int Round { get; set; } = 1;
    public bool IsOver { get; set; }
    public string? WinnerName { get; set; }
    public DateTime? TurnDeadline { get; set; }

    // convenience
    public string CurrentPlayerConnectionId =>
        Players.Count > CurrentPlayerIndex ? Players[CurrentPlayerIndex].ConnectionId : "";
    public string CurrentPlayerName =>
        Players.Count > CurrentPlayerIndex ? Players[CurrentPlayerIndex].Name : "";
}

public class YahtzeePlayer
{
    public string ConnectionId { get; set; } = "";
    public string Name { get; set; } = "";
    public Dictionary<string, int?> Scores { get; set; } = InitScorecard();
    public bool Connected { get; set; } = true;
    public bool IsBot { get; set; }
    public string AiDifficulty { get; set; } = "regular";

    public static Dictionary<string, int?> InitScorecard()
    {
        var card = new Dictionary<string, int?>();
        foreach (var c in YahtzeeScoring.Categories) card[c] = null;
        return card;
    }
}

public class YahtzeeSettings
{
    public int MaxPlayers { get; set; } = 4;            // 2-20
    public int RollsPerTurn { get; set; } = 3;          // 1-5
    public int NumberOfDice { get; set; } = 5;           // 3-8
    public int UpperBonusThreshold { get; set; } = 63;   // 0-999
    public int UpperBonusPoints { get; set; } = 35;      // 0-100
    public int TurnTimeLimitSeconds { get; set; } = 0;   // 0 = unlimited
    public int FullHouseScore { get; set; } = 25;
    public int SmallStraightScore { get; set; } = 30;
    public int LargeStraightScore { get; set; } = 40;
    public int YahtzeeScore { get; set; } = 50;
    public bool ForceScoreBestCategory { get; set; }     // must pick highest-scoring option
    public string RoomName { get; set; } = "Yahtzee Room";
    public bool IsPrivate { get; set; }
}

/* ================================================================
   Scoring helpers (static, stateless)
   ================================================================ */
public static class YahtzeeScoring
{
    public static readonly string[] Categories =
    [
        "ones", "twos", "threes", "fours", "fives", "sixes",
        "threeOfAKind", "fourOfAKind", "fullHouse",
        "smallStraight", "largeStraight", "yahtzee", "chance"
    ];

    public static int CalculateScore(string category, int[] dice, YahtzeeSettings settings)
    {
        var counts = new int[7];
        foreach (var d in dice) counts[d]++;
        int sum = dice.Sum();

        return category switch
        {
            "ones"   => dice.Where(d => d == 1).Sum(),
            "twos"   => dice.Where(d => d == 2).Sum(),
            "threes" => dice.Where(d => d == 3).Sum(),
            "fours"  => dice.Where(d => d == 4).Sum(),
            "fives"  => dice.Where(d => d == 5).Sum(),
            "sixes"  => dice.Where(d => d == 6).Sum(),
            "threeOfAKind" => counts.Any(c => c >= 3) ? sum : 0,
            "fourOfAKind"  => counts.Any(c => c >= 4) ? sum : 0,
            "fullHouse"    => counts.Contains(3) && counts.Contains(2) ? settings.FullHouseScore : 0,
            "smallStraight" => HasStraight(dice, 4) ? settings.SmallStraightScore : 0,
            "largeStraight" => HasStraight(dice, 5) ? settings.LargeStraightScore : 0,
            "yahtzee"       => counts.Any(c => c == 5) ? settings.YahtzeeScore : 0,
            "chance"        => sum,
            _ => 0
        };
    }

    public static void RollDice(YahtzeeRoom room)
    {
        var rng = Random.Shared;
        for (int i = 0; i < room.Settings.NumberOfDice; i++)
        {
            if (i < room.Held.Length && !room.Held[i])
                room.Dice[i] = rng.Next(1, 7);
        }
        room.RollsLeft--;
    }

    private static bool HasStraight(int[] dice, int length)
    {
        var unique = dice.Distinct().OrderBy(d => d).ToArray();
        int run = 1, maxRun = 1;
        for (int i = 1; i < unique.Length; i++)
        {
            if (unique[i] == unique[i - 1] + 1) { run++; maxRun = Math.Max(maxRun, run); }
            else run = 1;
        }
        return maxRun >= length;
    }

    public static int UpperBonus(Dictionary<string, int?> scores, YahtzeeSettings settings)
    {
        string[] upper = ["ones", "twos", "threes", "fours", "fives", "sixes"];
        int total = upper.Sum(c => scores.GetValueOrDefault(c) ?? 0);
        return total >= settings.UpperBonusThreshold ? settings.UpperBonusPoints : 0;
    }

    public static int TotalScore(Dictionary<string, int?> scores, YahtzeeSettings settings)
    {
        return scores.Values.Sum(v => v ?? 0) + UpperBonus(scores, settings);
    }
}
