namespace TacTacToe.Services;

/* ================================================================
   Solitaire — Klondike, 1–4 players on identical decks
   Compete for speed and efficiency (fewest stock cycles)
   ================================================================ */

public class SolitaireRoom
{
    public string Id { get; set; } = "";
    public string HostConnectionId { get; set; } = "";
    public string HostName { get; set; } = "";
    public List<SolitairePlayer> Players { get; set; } = [];
    public bool Started { get; set; }
    public bool IsOver { get; set; }
    public bool IsSinglePlayer { get; set; }
    public SolitaireSettings Settings { get; set; } = new();
    public int DeckSeed { get; set; }
    public int FinishCount { get; set; }
}

public class SolitaireSettings
{
    public string RoomName { get; set; } = "Solitaire Room";
    public int MaxPlayers { get; set; } = 4;
}

public class SolitairePlayer
{
    public string ConnectionId { get; set; } = "";
    public string Name { get; set; } = "";
    public bool Connected { get; set; } = true;
    public bool IsBot { get; set; }
    public SolitaireGameState Game { get; set; } = new();
    public int Score { get; set; }
    public bool HasFinished { get; set; }
    public int FinishRank { get; set; }
    public long StartedAtMs { get; set; }
    public long FinishedAtMs { get; set; }
}

public class SolitaireGameState
{
    // 7 tableau piles
    public List<SolitairePile> Tableau { get; set; } = [];

    // Top rank per suit: -1=empty, 0=Ace … 12=King; indexed by suit (0=♠1=♥2=♦3=♣)
    public int[] Foundation { get; set; } = [-1, -1, -1, -1];

    // Stock: face-down cards; draw from end (stock[^1] = next card)
    public List<int> Stock { get; set; } = [];

    // Waste: face-up; top = last element
    public List<int> Waste { get; set; } = [];

    public int StockCycles { get; set; }
    public int MoveCount { get; set; }

    public int CardsOnFoundation => Foundation.Sum(f => f >= 0 ? f + 1 : 0);
    public bool IsComplete => Foundation.All(f => f == 12);
}

public class SolitairePile
{
    public List<int> FaceDown { get; set; } = [];
    public List<int> FaceUp { get; set; } = [];
}

/* ================================================================
   Solitaire Engine
   card = 0–51; Rank = card % 13 (0=A…12=K); Suit = card / 13
   Suits: 0=♠ Spades  1=♥ Hearts  2=♦ Diamonds  3=♣ Clubs
   Red suits: Hearts (1) and Diamonds (2)
   ================================================================ */
public static class SolitaireEngine
{
    public static int Rank(int card) => card % 13;
    public static int Suit(int card) => card / 13;
    public static bool IsRed(int card) { var s = card / 13; return s is 1 or 2; }

    public static SolitaireGameState Deal(int seed)
    {
        var deck = Shuffle(seed);
        var state = new SolitaireGameState();
        int idx = 0;
        for (int pile = 0; pile < 7; pile++)
        {
            var p = new SolitairePile();
            for (int j = 0; j < pile; j++) p.FaceDown.Add(deck[idx++]);
            p.FaceUp.Add(deck[idx++]);
            state.Tableau.Add(p);
        }
        // Remaining cards → stock; stock[^1] = first card to draw
        while (idx < 52) state.Stock.Add(deck[idx++]);
        state.Stock.Reverse();
        return state;
    }

    private static List<int> Shuffle(int seed)
    {
        var deck = Enumerable.Range(0, 52).ToList();
        var rng = new Random(seed);
        for (int i = 51; i > 0; i--)
        {
            int j = rng.Next(i + 1);
            (deck[i], deck[j]) = (deck[j], deck[i]);
        }
        return deck;
    }

    // ── Validation helpers ──────────────────────────────────────

    public static bool CanGoToFoundation(int card, int[] foundation) =>
        Rank(card) == foundation[Suit(card)] + 1;

    public static bool CanGoToTableau(int card, SolitairePile pile)
    {
        if (pile.FaceUp.Count == 0 && pile.FaceDown.Count == 0)
            return Rank(card) == 12; // only Kings on empty piles
        if (pile.FaceUp.Count == 0) return false;
        var top = pile.FaceUp[^1];
        return IsRed(card) != IsRed(top) && Rank(card) == Rank(top) - 1;
    }

    static void AutoFlip(SolitairePile p)
    {
        if (p.FaceUp.Count == 0 && p.FaceDown.Count > 0)
        {
            p.FaceUp.Add(p.FaceDown[^1]);
            p.FaceDown.RemoveAt(p.FaceDown.Count - 1);
        }
    }

    // ── Moves ───────────────────────────────────────────────────

    public static bool FlipStock(SolitaireGameState g)
    {
        if (g.Stock.Count > 0)
        {
            g.Waste.Add(g.Stock[^1]);
            g.Stock.RemoveAt(g.Stock.Count - 1);
        }
        else
        {
            if (g.Waste.Count == 0) return false;
            g.Stock = g.Waste.AsEnumerable().Reverse().ToList();
            g.Waste.Clear();
            g.StockCycles++;
        }
        return true;
    }

    public static bool WasteToFoundation(SolitaireGameState g)
    {
        if (g.Waste.Count == 0) return false;
        var card = g.Waste[^1];
        if (!CanGoToFoundation(card, g.Foundation)) return false;
        g.Foundation[Suit(card)]++;
        g.Waste.RemoveAt(g.Waste.Count - 1);
        g.MoveCount++;
        return true;
    }

    public static bool WasteToTableau(SolitaireGameState g, int to)
    {
        if (g.Waste.Count == 0 || to < 0 || to >= 7) return false;
        var card = g.Waste[^1];
        if (!CanGoToTableau(card, g.Tableau[to])) return false;
        g.Tableau[to].FaceUp.Add(card);
        g.Waste.RemoveAt(g.Waste.Count - 1);
        g.MoveCount++;
        return true;
    }

    public static bool TableauToFoundation(SolitaireGameState g, int from)
    {
        if (from < 0 || from >= 7) return false;
        var pile = g.Tableau[from];
        if (pile.FaceUp.Count == 0) return false;
        var card = pile.FaceUp[^1];
        if (!CanGoToFoundation(card, g.Foundation)) return false;
        g.Foundation[Suit(card)]++;
        pile.FaceUp.RemoveAt(pile.FaceUp.Count - 1);
        AutoFlip(pile);
        g.MoveCount++;
        return true;
    }

    // cardFaceUpIdx: absolute index in FaceUp list (0=bottom face-up, Count-1=top)
    public static bool TableauToTableau(SolitaireGameState g, int from, int cardFaceUpIdx, int to)
    {
        if (from < 0 || from >= 7 || to < 0 || to >= 7 || from == to) return false;
        var fp = g.Tableau[from];
        var tp = g.Tableau[to];
        if (cardFaceUpIdx < 0 || cardFaceUpIdx >= fp.FaceUp.Count) return false;
        var movingCard = fp.FaceUp[cardFaceUpIdx];
        if (!CanGoToTableau(movingCard, tp)) return false;
        var moving = fp.FaceUp.Skip(cardFaceUpIdx).ToList();
        fp.FaceUp.RemoveRange(cardFaceUpIdx, fp.FaceUp.Count - cardFaceUpIdx);
        tp.FaceUp.AddRange(moving);
        AutoFlip(fp);
        g.MoveCount++;
        return true;
    }

    // Find a card in any tableau FaceUp list
    public static (int pile, int idx) FindInTableau(SolitaireGameState g, int cardId)
    {
        for (int p = 0; p < g.Tableau.Count; p++)
        {
            var idx = g.Tableau[p].FaceUp.IndexOf(cardId);
            if (idx >= 0) return (p, idx);
        }
        return (-1, -1);
    }

    // Can auto-complete? (no face-down cards, no stock)
    public static bool CanAutoComplete(SolitaireGameState g) =>
        g.Tableau.All(p => p.FaceDown.Count == 0) && g.Stock.Count == 0;

    // Apply one auto-complete step; returns true if something moved
    public static bool AutoCompleteStep(SolitaireGameState g)
    {
        if (!CanAutoComplete(g)) return false;
        if (g.Waste.Count > 0 && CanGoToFoundation(g.Waste[^1], g.Foundation))
        { WasteToFoundation(g); return true; }
        for (int i = 0; i < 7; i++)
            if (g.Tableau[i].FaceUp.Count > 0 && CanGoToFoundation(g.Tableau[i].FaceUp[^1], g.Foundation))
            { TableauToFoundation(g, i); return true; }
        return false;
    }

    public static int ScoreFor(SolitairePlayer p)
    {
        var g = p.Game;
        int score = g.CardsOnFoundation * 10;
        if (!p.HasFinished) return score;
        score += 500; // completion bonus
        int secs = (int)((p.FinishedAtMs - p.StartedAtMs) / 1000L);
        score += Math.Max(0, 1000 - secs * 2); // time bonus
        if (g.StockCycles <= 1) score += 300; // first-go bonus
        return score;
    }
}
