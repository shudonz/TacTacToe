namespace TacTacToe.Services;

public class CrazyEightsRoom
{
    public string Id { get; set; } = "";
    public string HostConnectionId { get; set; } = "";
    public string HostName { get; set; } = "";
    public List<CrazyEightsPlayer> Players { get; set; } = [];
    public CrazyEightsSettings Settings { get; set; } = new();
    public bool Started { get; set; }
    public bool IsOver { get; set; }
    public bool IsSinglePlayer { get; set; }
    public int CurrentPlayerIndex { get; set; }
    public string? WinnerName { get; set; }
    public int ActiveSuit { get; set; }
    public List<int> DrawPile { get; set; } = [];
    public List<int> DiscardPile { get; set; } = [];
    public long StartedAtMs { get; set; }
    public bool SessionsSaved { get; set; }
}

public class CrazyEightsSettings
{
    public string RoomName { get; set; } = "Crazy Eights Room";
    public int MaxPlayers { get; set; } = 4;
    public bool FillWithBotsOnStart { get; set; }
}

public class CrazyEightsPlayer
{
    public string ConnectionId { get; set; } = "";
    public string Name { get; set; } = "";
    public bool Connected { get; set; } = true;
    public bool IsBot { get; set; }
    public List<int> Hand { get; set; } = [];
    public int Score { get; set; }
    public int FinishRank { get; set; }
}

public class CrazyEightsHint
{
    public bool HintAvailable { get; set; }
    public bool ShouldDraw { get; set; }
    public int CardId { get; set; } = -1;
    public int SuggestedSuit { get; set; } = -1;
    public string Description { get; set; } = "";
}

public static class CrazyEightsEngine
{
    public const int WildRank = 7; // 8s are wild (A=0 ... 8=7)

    public static int Rank(int card) => card % 13;
    public static int Suit(int card) => card / 13;

    public static void StartGame(CrazyEightsRoom room, int cardsPerPlayer = 5)
    {
        room.Settings.MaxPlayers = Math.Clamp(room.Settings.MaxPlayers, 2, 4);
        room.Started = true;
        room.IsOver = false;
        room.WinnerName = null;
        room.CurrentPlayerIndex = 0;
        room.StartedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        room.SessionsSaved = false;

        foreach (var p in room.Players)
        {
            p.Hand.Clear();
            p.Score = 0;
            p.FinishRank = 0;
        }

        var deck = Enumerable.Range(0, 52).OrderBy(_ => Random.Shared.Next()).ToList();
        room.DrawPile = deck;
        room.DiscardPile.Clear();

        for (int c = 0; c < cardsPerPlayer; c++)
        {
            foreach (var player in room.Players)
            {
                player.Hand.Add(DrawRaw(room));
            }
        }

        var first = DrawRaw(room);
        while (Rank(first) == WildRank && room.DrawPile.Count > 0)
        {
            room.DrawPile.Insert(0, first);
            first = DrawRaw(room);
        }

        room.DiscardPile.Add(first);
        room.ActiveSuit = Suit(first);
    }

    public static bool CanPlayCard(CrazyEightsRoom room, int card)
    {
        if (room.DiscardPile.Count == 0) return true;
        var top = room.DiscardPile[^1];
        return Rank(card) == WildRank || Suit(card) == room.ActiveSuit || Rank(card) == Rank(top);
    }

    public static List<int> GetPlayableCards(CrazyEightsRoom room, CrazyEightsPlayer player) =>
        player.Hand.Where(c => CanPlayCard(room, c)).ToList();

    public static bool PlayCard(CrazyEightsRoom room, int playerIndex, int cardId, int? chosenSuit, out bool won)
    {
        won = false;
        if (playerIndex < 0 || playerIndex >= room.Players.Count) return false;

        var p = room.Players[playerIndex];
        if (!p.Hand.Contains(cardId)) return false;
        if (!CanPlayCard(room, cardId)) return false;

        p.Hand.Remove(cardId);
        room.DiscardPile.Add(cardId);

        if (Rank(cardId) == WildRank)
        {
            int suit = chosenSuit.HasValue ? Math.Clamp(chosenSuit.Value, 0, 3) : BestSuitForHand(p.Hand);
            room.ActiveSuit = suit;
        }
        else
        {
            room.ActiveSuit = Suit(cardId);
        }

        p.Score = ScoreForHand(p.Hand);
        if (p.Hand.Count == 0)
        {
            won = true;
            p.FinishRank = 1;
        }

        return true;
    }

    public static bool DrawOne(CrazyEightsRoom room, int playerIndex, out int cardId)
    {
        cardId = -1;
        if (playerIndex < 0 || playerIndex >= room.Players.Count) return false;
        if (!EnsureDrawAvailable(room)) return false;

        cardId = DrawRaw(room);
        room.Players[playerIndex].Hand.Add(cardId);
        room.Players[playerIndex].Score = ScoreForHand(room.Players[playerIndex].Hand);
        return true;
    }

    public static bool HasPlayableCard(CrazyEightsRoom room, int playerIndex)
    {
        if (playerIndex < 0 || playerIndex >= room.Players.Count) return false;
        return room.Players[playerIndex].Hand.Any(c => CanPlayCard(room, c));
    }

    public static bool CanDraw(CrazyEightsRoom room)
    {
        if (room.DrawPile.Count > 0) return true;
        return room.DiscardPile.Count > 1;
    }

    public static int BestSuitForHand(IEnumerable<int> hand)
    {
        var groups = hand.GroupBy(Suit).Select(g => new { Suit = g.Key, Count = g.Count() }).ToList();
        if (groups.Count == 0) return Random.Shared.Next(0, 4);
        int max = groups.Max(g => g.Count);
        return groups.Where(g => g.Count == max).OrderBy(_ => Random.Shared.Next()).First().Suit;
    }

    public static CrazyEightsHint ComputeHint(CrazyEightsRoom room, int playerIndex)
    {
        if (playerIndex < 0 || playerIndex >= room.Players.Count)
            return new CrazyEightsHint { HintAvailable = false, Description = "No hint available." };

        var player = room.Players[playerIndex];
        var playable = GetPlayableCards(room, player);
        if (playable.Count > 0)
        {
            var nonWild = playable.Where(c => Rank(c) != WildRank).ToList();
            int card = nonWild.Count > 0 ? nonWild[0] : playable[0];
            int suggestedSuit = Rank(card) == WildRank ? BestSuitForHand(player.Hand.Where(c => c != card)) : Suit(card);
            var suitName = SuitName(suggestedSuit);
            return new CrazyEightsHint
            {
                HintAvailable = true,
                CardId = card,
                SuggestedSuit = suggestedSuit,
                Description = Rank(card) == WildRank
                    ? $"Play an 8 and call {suitName}."
                    : $"Play {CardLabel(card)}."
            };
        }

        if (CanDraw(room))
        {
            return new CrazyEightsHint
            {
                HintAvailable = true,
                ShouldDraw = true,
                Description = "Draw one card."
            };
        }

        return new CrazyEightsHint
        {
            HintAvailable = false,
            Description = "No legal moves available."
        };
    }

    public static int ScoreForHand(IEnumerable<int> hand)
    {
        int score = 0;
        foreach (var card in hand)
        {
            var r = Rank(card);
            score += r == WildRank ? 50 : Math.Min(10, r + 1);
        }
        return score;
    }

    public static string CardLabel(int card)
    {
        string rank = Rank(card) switch
        {
            0 => "A",
            10 => "J",
            11 => "Q",
            12 => "K",
            var r => (r + 1).ToString()
        };
        return rank + SuitSymbol(Suit(card));
    }

    public static string SuitName(int suit) => suit switch
    {
        0 => "Spades",
        1 => "Hearts",
        2 => "Diamonds",
        _ => "Clubs"
    };

    public static string SuitSymbol(int suit) => suit switch
    {
        0 => "♠",
        1 => "♥",
        2 => "♦",
        _ => "♣"
    };

    private static bool EnsureDrawAvailable(CrazyEightsRoom room)
    {
        if (room.DrawPile.Count > 0) return true;
        if (room.DiscardPile.Count <= 1) return false;

        var top = room.DiscardPile[^1];
        var refill = room.DiscardPile.Take(room.DiscardPile.Count - 1).OrderBy(_ => Random.Shared.Next()).ToList();
        room.DrawPile = refill;
        room.DiscardPile = [top];
        return room.DrawPile.Count > 0;
    }

    private static int DrawRaw(CrazyEightsRoom room)
    {
        var idx = room.DrawPile.Count - 1;
        var card = room.DrawPile[idx];
        room.DrawPile.RemoveAt(idx);
        return card;
    }
}
