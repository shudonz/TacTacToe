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
    // Number of hints the player has used in this game. Each hint deducts a penalty from final score.
    public int HintsUsed { get; set; }
    public bool GaveUp { get; set; }
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

    public static int GetWinnableSeed(int randomAttempts = 80)
    {
        for (int i = 0; i < randomAttempts; i++)
        {
            var seed = Random.Shared.Next();
            if (IsLikelyWinnable(Deal(seed))) return seed;
        }

        // Deterministic fallback: keep searching until we find a solver-verified seed.
        for (int seed = 0; seed <= 200000; seed++)
            if (IsLikelyWinnable(Deal(seed))) return seed;

        // Emergency fallback (should be extremely rare)
        return Random.Shared.Next();
    }

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
        if (!p.HasFinished || p.GaveUp) return score;
        score += 500; // completion bonus
        int secs = (int)((p.FinishedAtMs - p.StartedAtMs) / 1000L);
        score += Math.Max(0, 1000 - secs * 2); // time bonus
        if (g.StockCycles <= 1) score += 300; // first-go bonus
        // Apply hint penalty: each hint used deducts points from final score
        const int HintPenalty = 50;
        score -= p.HintsUsed * HintPenalty;
        if (score < 0) score = 0;
        return score;
    }

    // Hint DTOs (serialized to client)
    public class HintSourceDto
    {
        public string Type { get; set; } = ""; // "tableau","waste","stock","facedown"
        public int PileIdx { get; set; } = -1;
        public int FaceUpIdx { get; set; } = -1;
        public int CardId { get; set; } = -1;
    }
    public class HintDestDto
    {
        public string Type { get; set; } = ""; // "tableau","foundation"
        public int PileIdx { get; set; } = -1;
    }
    public class HintDto
    {
        public bool HintAvailable { get; set; }
        public string HintType { get; set; } = null!;
        public string Description { get; set; } = null!;
        public HintSourceDto? Source { get; set; }
        public HintDestDto? Dest { get; set; }
    }

    // Compute a deterministic hint following the specified priority order
    public static HintDto ComputeHint(SolitaireGameState g)
    {
        // Helpers
        string CardLabel(int card) => Rank(card) switch
        {
            0 => "A",
            10 => "J",
            11 => "Q",
            12 => "K",
            var r => (r + 1).ToString()
        } + (Suit(card) switch { 0 => "♠", 1 => "♥", 2 => "♦", 3 => "♣", _ => "" });

        string DestTopLabel(SolitairePile pile)
        {
            if (pile.FaceUp.Count == 0) return "the empty column";
            return CardLabel(pile.FaceUp[^1]);
        }

        // Step 1 — Tableau → Foundation
        for (int p = 0; p < 7; p++)
        {
            var pile = g.Tableau[p];
            if (pile.FaceUp.Count == 0) continue;
            var card = pile.FaceUp[^1];
            if (CanGoToFoundation(card, g.Foundation))
            {
                var suit = Suit(card);
                return new HintDto
                {
                    HintAvailable = true,
                    HintType = "TableauToFoundation",
                    Description = $"Move {CardLabel(card)} from column {p + 1} to the {(suit == 0 ? "Spades" : suit == 1 ? "Hearts" : suit == 2 ? "Diamonds" : "Clubs")} foundation.",
                    Source = new HintSourceDto { Type = "tableau", PileIdx = p, FaceUpIdx = pile.FaceUp.Count - 1, CardId = card },
                    Dest = new HintDestDto { Type = "foundation", PileIdx = suit }
                };
            }
        }

        // Step 2 — Waste → Foundation
        if (g.Waste.Count > 0)
        {
            var card = g.Waste[^1];
            if (CanGoToFoundation(card, g.Foundation))
            {
                var suit = Suit(card);
                return new HintDto
                {
                    HintAvailable = true,
                    HintType = "WasteToFoundation",
                    Description = $"Move {CardLabel(card)} from the waste to the {(suit == 0 ? "Spades" : suit == 1 ? "Hearts" : suit == 2 ? "Diamonds" : "Clubs")} foundation.",
                    Source = new HintSourceDto { Type = "waste", CardId = card },
                    Dest = new HintDestDto { Type = "foundation", PileIdx = suit }
                };
            }
        }

        // Step 3 — Tableau → Tableau
        for (int from = 0; from < 7; from++)
        {
            var fromPile = g.Tableau[from];
            for (int fup = 0; fup < fromPile.FaceUp.Count; fup++)
            {
                var card = fromPile.FaceUp[fup];
                for (int to = 0; to < 7; to++)
                {
                    if (from == to) continue;
                    if (CanGoToTableau(card, g.Tableau[to]))
                    {
                        if (!IsStrategicTableauMove(g, from, fup, to))
                            continue;

                        return new HintDto
                        {
                            HintAvailable = true,
                            HintType = "TableauToTableau",
                            Description = $"Move {CardLabel(card)} from column {from + 1} onto {DestTopLabel(g.Tableau[to])} in column {to + 1}.",
                            Source = new HintSourceDto { Type = "tableau", PileIdx = from, FaceUpIdx = fup, CardId = card },
                            Dest = new HintDestDto { Type = "tableau", PileIdx = to }
                        };
                    }
                }
            }
        }

        // Step 4 — Waste → Tableau
        if (g.Waste.Count > 0)
        {
            var card = g.Waste[^1];
            for (int to = 0; to < 7; to++)
            {
                if (CanGoToTableau(card, g.Tableau[to]))
                {
                    return new HintDto
                    {
                        HintAvailable = true,
                        HintType = "WasteToTableau",
                        Description = $"Move {CardLabel(card)} from the waste onto {DestTopLabel(g.Tableau[to])} in column {to + 1}.",
                        Source = new HintSourceDto { Type = "waste", CardId = card },
                        Dest = new HintDestDto { Type = "tableau", PileIdx = to }
                    };
                }
            }
        }

        // Step 5 — Stock → Waste
        if (g.Stock.Count > 0)
        {
            return new HintDto
            {
                HintAvailable = true,
                HintType = "StockToWaste",
                Description = $"Draw from the stock pile ({g.Stock.Count} card{(g.Stock.Count > 1 ? "s" : "")} remaining).",
                Source = new HintSourceDto { Type = "stock" },
                Dest = null
            };
        }

        // Step 5b — Recycle Waste → Stock
        if (g.Waste.Count > 0)
        {
            return new HintDto
            {
                HintAvailable = true,
                HintType = "RecycleWaste",
                Description = $"Recycle the waste back into stock ({g.Waste.Count} card{(g.Waste.Count > 1 ? "s" : "")}).",
                Source = new HintSourceDto { Type = "stock" },
                Dest = null
            };
        }

        // Step 6 — Auto-flip
        for (int p = 0; p < 7; p++)
        {
            var pile = g.Tableau[p];
            if (pile.FaceUp.Count == 0 && pile.FaceDown.Count > 0)
            {
                return new HintDto
                {
                    HintAvailable = true,
                    HintType = "AutoFlip",
                    Description = $"Flip the top face-down card in column {p + 1}.",
                    Source = new HintSourceDto { Type = "facedown", PileIdx = p },
                    Dest = null
                };
            }
        }

        // Step 7 — No moves
        return new HintDto { HintAvailable = false, Description = "No legal moves remain." };
    }

    private static bool IsStrategicTableauMove(SolitaireGameState g, int from, int faceUpIdx, int to)
    {
        if (from < 0 || from >= 7 || to < 0 || to >= 7 || from == to) return false;
        var fromPile = g.Tableau[from];
        var toPile = g.Tableau[to];
        if (faceUpIdx < 0 || faceUpIdx >= fromPile.FaceUp.Count) return false;

        var movingCard = fromPile.FaceUp[faceUpIdx];
        if (!CanGoToTableau(movingCard, toPile)) return false;

        // Strong signal of progress: reveals a hidden card.
        if (faceUpIdx == 0 && fromPile.FaceDown.Count > 0) return true;

        // Useful king move to an empty column if it helps expose hidden cards eventually.
        bool toEmpty = toPile.FaceUp.Count == 0 && toPile.FaceDown.Count == 0;
        if (toEmpty && Rank(movingCard) == 12 && fromPile.FaceDown.Count > 0) return true;

        // Keep move only if it increases immediate foundation opportunities.
        int before = CountImmediateFoundationMoves(g);
        var sim = CloneGameState(g);
        if (!TableauToTableau(sim, from, faceUpIdx, to)) return false;
        int after = CountImmediateFoundationMoves(sim);
        return after > before;
    }

    private static int CountImmediateFoundationMoves(SolitaireGameState g)
    {
        int count = 0;
        if (g.Waste.Count > 0 && CanGoToFoundation(g.Waste[^1], g.Foundation)) count++;
        for (int i = 0; i < 7; i++)
        {
            var pile = g.Tableau[i];
            if (pile.FaceUp.Count > 0 && CanGoToFoundation(pile.FaceUp[^1], g.Foundation)) count++;
        }
        return count;
    }

    private static SolitaireGameState CloneGameState(SolitaireGameState g) => new()
    {
        Foundation = [.. g.Foundation],
        Stock = [.. g.Stock],
        Waste = [.. g.Waste],
        StockCycles = g.StockCycles,
        MoveCount = g.MoveCount,
        Tableau = g.Tableau.Select(p => new SolitairePile
        {
            FaceDown = [.. p.FaceDown],
            FaceUp = [.. p.FaceUp]
        }).ToList()
    };

    private static bool IsLikelyWinnable(SolitaireGameState original)
    {
        var start = CloneGameState(original);
        var stack = new Stack<(SolitaireGameState State, int Depth)>();
        var seen = new HashSet<string>();
        stack.Push((start, 0));

        const int MaxNodes = 60000;
        const int MaxDepth = 300;
        int nodes = 0;

        while (stack.Count > 0 && nodes < MaxNodes)
        {
            var (state, depth) = stack.Pop();
            if (state.IsComplete) return true;

            var key = SerializeState(state);
            if (!seen.Add(key)) continue;
            nodes++;
            if (depth >= MaxDepth) continue;

            var next = EnumerateLikelyProgressMoves(state);
            for (int i = next.Count - 1; i >= 0; i--)
                stack.Push((next[i], depth + 1));
        }

        return false;
    }

    private static List<SolitaireGameState> EnumerateLikelyProgressMoves(SolitaireGameState g)
    {
        var next = new List<SolitaireGameState>(24);

        void TryAdd(Func<SolitaireGameState, bool> apply)
        {
            var clone = CloneGameState(g);
            if (apply(clone))
                next.Add(clone);
        }

        // Priority 1: move to foundations whenever possible.
        TryAdd(WasteToFoundation);
        for (int from = 0; from < 7; from++)
        {
            int pileIdx = from;
            TryAdd(s => TableauToFoundation(s, pileIdx));
        }

        // Priority 2: strategic tableau rearrangements.
        for (int from = 0; from < 7; from++)
        {
            var fromPile = g.Tableau[from];
            for (int fup = 0; fup < fromPile.FaceUp.Count; fup++)
            {
                for (int to = 0; to < 7; to++)
                {
                    if (!IsStrategicTableauMove(g, from, fup, to)) continue;
                    int ff = from, fi = fup, tt = to;
                    TryAdd(s => TableauToTableau(s, ff, fi, tt));
                }
            }
        }

        // Priority 3: waste to tableau.
        for (int to = 0; to < 7; to++)
        {
            int tt = to;
            TryAdd(s => WasteToTableau(s, tt));
        }

        // Priority 4: draw/recycle stock.
        TryAdd(FlipStock);

        return next;
    }

    private static string SerializeState(SolitaireGameState g)
    {
        var sb = new System.Text.StringBuilder(512);
        sb.AppendJoin(',', g.Foundation).Append('|');
        sb.AppendJoin(',', g.Stock).Append('|');
        sb.AppendJoin(',', g.Waste).Append('|');
        for (int p = 0; p < g.Tableau.Count; p++)
        {
            if (p > 0) sb.Append('|');
            sb.AppendJoin(',', g.Tableau[p].FaceDown).Append('/');
            sb.AppendJoin(',', g.Tableau[p].FaceUp);
        }
        return sb.ToString();
    }
}
