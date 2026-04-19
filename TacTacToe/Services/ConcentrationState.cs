namespace TacTacToe.Services;

public class ConcentrationRoom
{
    public string Id { get; set; } = "";
    public string HostConnectionId { get; set; } = "";
    public string HostName { get; set; } = "";
    public List<ConcentrationPlayer> Players { get; set; } = [];
    public bool Started { get; set; }
    public bool IsOver { get; set; }
    public bool IsSinglePlayer { get; set; }
    public string? WinnerName { get; set; }
    public ConcentrationSettings Settings { get; set; } = new();
    public List<string> Deck { get; set; } = [];
    public bool[] Matched { get; set; } = [];
    public int CurrentPlayerIndex { get; set; }
    public List<int> TurnRevealedIndexes { get; set; } = [];
}

public class ConcentrationSettings
{
    public string RoomName { get; set; } = "Concentration Madness";
    public int MaxPlayers { get; set; } = 4;
    public int PairCount { get; set; } = 12;
}

public class ConcentrationPlayer
{
    public string ConnectionId { get; set; } = "";
    public string Name { get; set; } = "";
    public int Score { get; set; }
    public bool Connected { get; set; } = true;
    public bool IsBot { get; set; }
}

public static class ConcentrationEngine
{
    public static readonly string[] EmojiPool =
    [
        "🐶", "🐱", "🦊", "🐼", "🐸", "🐵", "🦄", "🐙",
        "🐢", "🦋", "🌈", "⚡", "🔥", "❄️", "🍕", "🍩",
        "🍓", "🍉", "🚀", "🎧", "🎸", "🎮", "🎯", "🏆"
    ];

    public static List<string> CreateDeck(int pairCount)
    {
        pairCount = Math.Clamp(pairCount, 6, EmojiPool.Length);
        var chosen = EmojiPool.OrderBy(_ => Random.Shared.Next()).Take(pairCount).ToList();
        var deck = chosen.Concat(chosen).OrderBy(_ => Random.Shared.Next()).ToList();
        return deck;
    }
}
